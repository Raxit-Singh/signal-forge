// GitHub public issue search (REST `GET /search/issues`).
// Unauthenticated: 10 search requests/minute per IP. With a token: 30/minute.
// A token with *no* scopes is enough for public data and is recommended.
// Search returns at most 1,000 results per query; narrower windows avoid it.

import { SourceError, httpError, retryAfterSeconds } from "./errors.ts";
import { excerpt, markdownToText, sum } from "./text.ts";
import type { CandidateMention, SearchRequest, SearchResult, SourceAdapter, SourceContext } from "./types.ts";

const API = "https://api.github.com";
const PER_PAGE = 100;
const MAX_OR_TERMS = 5;

export interface GithubIssue {
  id: number;
  html_url: string;
  title: string;
  body?: string | null;
  created_at: string;
  comments?: number;
  repository_url?: string;
  pull_request?: unknown;
  user?: { login?: string; id?: number; type?: string } | null;
  reactions?: { total_count?: number } | null;
  state?: string;
}

interface SearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GithubIssue[];
}

function numHeader(res: Response, name: string): number | undefined {
  const v = res.headers.get(name);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function isoNoMs(d: Date) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `"a" OR "b" in:title,body is:issue created:X..Y` — qualifiers apply to the whole query. */
export function githubQuery(terms: string[], since: Date, until: Date): string {
  const quoted = terms.slice(0, MAX_OR_TERMS).map((t) => `"${t.replace(/"/g, "").trim()}"`);
  return `${quoted.join(" OR ")} in:title,body is:issue created:${isoNoMs(since)}..${isoNoMs(new Date(until.getTime() - 1000))}`;
}

/**
 * Separates what the reporter wrote from pasted material. Issue templates
 * often collect environment dumps (installed extensions, package lists) in
 * <details> blocks; a product named only there isn't being discussed.
 * Code blocks are kept as weak evidence (a stack trace or import can be a
 * real report, but often isn't).
 */
export function splitIssueBody(body: string): { prose: string; code: string } {
  const code: string[] = [];
  const prose = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<details[\s\S]*?<\/details>/gi, " ")
    .replace(/```[\s\S]*?(```|$)/g, (block) => {
      code.push(block);
      return " ";
    });
  return { prose, code: code.join("\n") };
}

export function normalizeGithubIssue(issue: GithubIssue): CandidateMention | null {
  if (!issue?.id || !issue.html_url?.startsWith("https://github.com/")) return null;
  if (issue.pull_request) return null;
  // Automated accounts (dependency bots, CI) are not customer voices.
  if (issue.user?.type === "Bot" || /\[bot\]$/i.test(issue.user?.login ?? "")) return null;
  const repo = issue.repository_url?.replace(`${API}/repos/`, "") ?? null;
  const body = splitIssueBody(issue.body ?? "");
  const reactions = issue.reactions?.total_count ?? 0;
  const comments = issue.comments ?? 0;
  return {
    externalId: String(issue.id),
    sourceUrl: issue.html_url,
    parentExternalId: repo,
    authorExternalId: issue.user?.id ? String(issue.user.id) : issue.user?.login ?? null,
    authorDisplay: issue.user?.login ?? null,
    title: issue.title?.slice(0, 500) ?? null,
    content: excerpt(markdownToText(issue.body)),
    publishedAt: new Date(issue.created_at),
    engagement: { comments, reactions },
    engagementScore: sum([comments, reactions]),
    linkedUrl: null,
    matchText: `${issue.title ?? ""}\n${body.prose}`,
    contextText: [repo, body.code].filter(Boolean).join("\n") || null,
  };
}

export function createGithubAdapter(token?: string): SourceAdapter {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "SignalForge",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function check(res: Response): Promise<void> {
    if (res.ok) return;
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    if ((res.status === 403 || res.status === 429) && (remaining === "0" || res.headers.has("retry-after"))) {
      const wait = retryAfterSeconds(res.headers.get("retry-after")) ?? (Number.isFinite(reset) ? Math.max(1, reset - Math.floor(Date.now() / 1000)) : 60);
      throw new SourceError("rate_limited", `GitHub: rate limited, resets in ${wait}s`, { retryAfterSeconds: wait, status: res.status });
    }
    if (res.status === 422) throw new SourceError("bad_request", "GitHub: search query rejected (422)", { status: 422 });
    throw httpError("GitHub", res);
  }

  return {
    id: "github",
    name: "GitHub",
    configured: () => ({ ok: true }),
    // Leaves headroom under GitHub's own per-minute search limit.
    rateLimit: () => (token
      ? { key: "github:search:token", capacity: 25, refillPerSecond: 25 / 60 }
      : { key: "github:search:anon", capacity: 8, refillPerSecond: 8 / 60 }),

    async searchMentions(req: SearchRequest, ctx: SourceContext): Promise<SearchResult> {
      const q = githubQuery(req.terms, req.window.since, req.window.until);
      const items = new Map<string, CandidateMention>();
      let complete = true;
      let reason: string | undefined;
      let rateLimit: SearchResult["rateLimit"];

      for (let page = 1; page <= req.maxPages; page++) {
        const params = new URLSearchParams({ q, sort: "created", order: "desc", per_page: String(PER_PAGE), page: String(page) });
        const res = await ctx.request({ url: `${API}/search/issues?${params}`, endpoint: "search/issues", headers, signal: req.signal });
        await check(res);
        const reset = numHeader(res, "x-ratelimit-reset");
        rateLimit = {
          remaining: numHeader(res, "x-ratelimit-remaining"),
          limit: numHeader(res, "x-ratelimit-limit"),
          resetAt: reset !== undefined ? new Date(reset * 1000).toISOString() : undefined,
        };
        const body = (await res.json()) as SearchResponse;
        if (!Array.isArray(body.items)) throw new SourceError("transient", "GitHub: unexpected response shape");
        for (const issue of body.items) {
          const m = normalizeGithubIssue(issue);
          if (m) items.set(m.externalId, m);
        }
        if (body.incomplete_results) {
          complete = false;
          reason = "GitHub reported incomplete search results (search timed out on their side).";
        }
        const seen = page * PER_PAGE;
        if (seen >= body.total_count || body.items.length < PER_PAGE) break;
        if (page === req.maxPages || seen >= 1000) {
          complete = false;
          reason = `${body.total_count} matching issues; only the newest ${seen} were collected.`;
          break;
        }
      }
      return { items: [...items.values()], complete, incompleteReason: reason, rateLimit };
    },

    async validateCredentials(ctx) {
      const res = await ctx.request({ url: `${API}/rate_limit`, endpoint: "rate_limit", headers });
      await check(res);
    },
  };
}
