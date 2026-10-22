// Serper (google.serper.dev) for Web (Google Search) and News (Google News).
// Paid in credits ($50 = 50,000 credits ⇒ $0.001 per credit at the entry pack): up to 10
// results cost 1 credit, 11–100 results cost 2; each response reports the credits used and
// that is what is settled. Free accounts return at most 10 news articles (1 credit) and
// reject quoted phrases, so a rejected quoted query is retried without quotes. Replaces API
// Direct's web ($0.004 per page) and news ($0.008 per request) searches when
// SERPER_API_KEY is set; results are normalized exactly like API Direct's (same
// ids, so a page found through either provider is stored once).

import { SourceError } from "../errors.ts";
import type { CandidateMention, SearchRequest, SearchResult, SourceAdapter, SourceContext, PaidSourceId } from "../types.ts";
import { normalizeNewsArticle, normalizeWebResult } from "../apidirect/normalizers.ts";

export const SERPER_BASE = "https://google.serper.dev";

export const SERPER_ENDPOINTS = {
  /** 10 results (1 credit). */
  web: { pricingKey: "serper_web.search", path: "/search", num: 10, credits: 1 },
  /** Up to 100 articles (2 credits on paid accounts; free accounts return 10 for 1 credit). */
  news: { pricingKey: "serper_news.credits", path: "/news", num: 100, credits: 2 },
} as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Google's `tbs` time filter for the window: past hour/day/week/month/year, or none. */
export function serperTimeFilter(windowMs: number): string | undefined {
  if (windowMs <= HOUR) return "qdr:h";
  if (windowMs <= DAY) return "qdr:d";
  if (windowMs <= 7 * DAY) return "qdr:w";
  if (windowMs <= 31 * DAY) return "qdr:m";
  if (windowMs <= 365 * DAY) return "qdr:y";
  return undefined;
}

/**
 * Serper news dates are relative ("3 hours ago", "2 days ago") or absolute
 * ("Oct 21, 2026"). Returns null when the text can't be read (the article is
 * then skipped rather than given a guessed date).
 */
export function parseSerperDate(text: string | null | undefined, now: Date): Date | null {
  if (!text) return null;
  const s = text.trim().toLowerCase();
  const rel = /^(\d+)\s*(second|sec|minute|min|hour|hr|day|week|month|year)s?\s+ago$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!;
    const ms = unit.startsWith("sec") ? 1000 : unit.startsWith("min") ? 60_000 : unit.startsWith("h") ? HOUR
      : unit === "day" ? DAY : unit === "week" ? 7 * DAY : unit === "month" ? 30 * DAY : 365 * DAY;
    return new Date(now.getTime() - n * ms);
  }
  if (s === "yesterday") return new Date(now.getTime() - DAY);
  const abs = new Date(`${text.trim()} UTC`);
  if (!Number.isNaN(abs.getTime()) && abs.getTime() <= now.getTime() + DAY) return abs;
  return null;
}

function queryOf(req: SearchRequest): string {
  const q = (req.query ?? req.terms.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(" OR ")).trim();
  if (!q) throw new SourceError("bad_request", "Empty query");
  return q.slice(0, 400);
}

export function serperError(status: number, message: string): SourceError {
  if (status === 401 || status === 403) return new SourceError("auth", `Serper ${status}: API key rejected`, { status });
  if (status === 402 || /credit|balance|quota/i.test(message)) return new SourceError("budget", "Serper: credits used up", { status, retryAfterSeconds: 6 * 3600 });
  if (status === 429) return new SourceError("rate_limited", "Serper 429", { status, retryAfterSeconds: 30 });
  if (status >= 500) return new SourceError("transient", `Serper ${status}`, { status, retryAfterSeconds: 60 });
  return new SourceError("bad_request", `Serper ${status}: ${message.slice(0, 160) || "invalid request"}`, { status });
}

interface SerperOrganic { title?: string; link?: string; snippet?: string; date?: string }
interface SerperNews { title?: string; link?: string; snippet?: string; date?: string; source?: string }

/** One paid POST. Serper bills answered queries; errors are not charged. */
async function serperPost<T>(
  ctx: SourceContext, apiKey: string, ep: { pricingKey: string; path: string; credits: number }, body: Record<string, unknown>,
  list: (d: T) => unknown[] | undefined, signal?: AbortSignal,
): Promise<{ data: T; ledgerId: string | null }> {
  const paid = await ctx.paidRequest({
    url: `${SERPER_BASE}${ep.path}`,
    endpoint: ep.path,
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    billing: { pricingKey: ep.pricingKey, units: ep.credits, purpose: "search" },
  });
  const res = paid.response;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.ok && data && typeof data === "object") {
    const items = list(data as T);
    // Serper reports the credits it charged; free accounts get 10 results for 1 credit even when more are asked for.
    const credits = (data as { credits?: unknown }).credits;
    const billed = typeof credits === "number" && credits >= 0 && credits <= 10 ? credits : ep.credits;
    await paid.settle({ billedUnits: billed, results: Array.isArray(items) ? items.length : null });
    if (!Array.isArray(items) && items !== undefined) throw new SourceError("bad_request", `Serper ${ep.path}: unexpected response shape`);
    return { data: data as T, ledgerId: paid.ledgerId };
  }
  await paid.settle({ billedUnits: 0, errorCode: String(res.status), results: null });
  const msg = data && typeof data === "object" && "message" in data ? String((data as { message: unknown }).message) : "";
  const err = serperError(res.status, msg);
  if (err.kind === "budget") await ctx.cooldown(err.retryAfterSeconds ?? 3600, ep.path);
  throw err;
}

const tag = (items: CandidateMention[], id: string | null) => {
  for (const i of items) {
    i.originRequestId = id;
    i.dataProvider = "serper";
  }
  return items;
};

/** Serper's free accounts reject quoted phrases ("Query pattern not allowed for free accounts"). */
const FREE_PATTERN = /not allowed for free accounts/i;
const unquoted = (q: string) => q.replace(/"/g, "");

/** Posts once; if a free account rejects the quoted query, retries it without quotes (the matcher still requires the phrase). */
async function withFreeFallback<T>(run: (q: string) => Promise<T>, q: string): Promise<T> {
  try {
    return await run(q);
  } catch (e) {
    if (e instanceof SourceError && e.kind === "bad_request" && FREE_PATTERN.test(e.message) && q.includes('"')) return run(unquoted(q));
    throw e;
  }
}

export function createSerperSearch(apiKey: string): Pick<Record<PaidSourceId, SourceAdapter["searchMentions"]>, "web" | "news"> {
  return {
    async web(req, ctx) {
      const tbs = serperTimeFilter(req.window.until.getTime() - req.window.since.getTime());
      const r = await withFreeFallback((q) => serperPost<{ organic?: SerperOrganic[] }>(ctx, apiKey, SERPER_ENDPOINTS.web,
        { q, num: SERPER_ENDPOINTS.web.num, ...(tbs ? { tbs } : {}) }, (d) => d.organic ?? [], req.signal), queryOf(req));
      const now = ctx.now();
      const items = (r.data.organic ?? [])
        .filter((o): o is SerperOrganic & { link: string } => typeof o.link === "string")
        .map((o) => normalizeWebResult({ url: o.link, title: o.title, snippet: o.snippet, domain: hostOf(o.link) }, now, req.target?.websiteDomain))
        .filter((x): x is CandidateMention => x !== null);
      return {
        items: tag(items, r.ledgerId), complete: false, saturated: false, pagesRequested: 1,
        incompleteReason: "Web search returns ranked results without publication dates, not a complete feed.",
      } satisfies SearchResult;
    },

    async news(req, ctx) {
      const tbs = serperTimeFilter(req.window.until.getTime() - req.window.since.getTime());
      const r = await withFreeFallback((q) => serperPost<{ news?: SerperNews[] }>(ctx, apiKey, SERPER_ENDPOINTS.news,
        { q, num: SERPER_ENDPOINTS.news.num, ...(tbs ? { tbs } : {}) }, (d) => d.news ?? [], req.signal), queryOf(req));
      const now = ctx.now();
      const list = r.data.news ?? [];
      const items = list
        .map((a) => {
          const at = parseSerperDate(a.date, now);
          if (!a.link || !at) return null;
          return normalizeNewsArticle({ url: a.link, title: a.title, snippet: a.snippet, published_datetime_utc: at.toISOString(), source_name: a.source, domain: hostOf(a.link) }, req.target?.websiteDomain);
        })
        .filter((x): x is CandidateMention => x !== null)
        .filter((i) => i.publishedAt >= req.window.since && i.publishedAt <= req.window.until);
      // Free accounts cap news at 10 articles; a full page of either size means more may exist.
      const saturated = list.length >= SERPER_ENDPOINTS.news.num || list.length === 10;
      return {
        items: tag(items, r.ledgerId), complete: !saturated, saturated, pagesRequested: 1,
        incompleteReason: saturated ? `News search returned its ${SERPER_ENDPOINTS.news.num}-article maximum; more articles may exist.` : undefined,
      } satisfies SearchResult;
    },
  };
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** The API Direct adapters with Serper search for Web and News when a Serper key is set. */
export function withSerperSearch(adapters: Record<PaidSourceId, SourceAdapter>, apiKey: string | undefined): Record<PaidSourceId, SourceAdapter> {
  if (!apiKey) return adapters;
  const search = createSerperSearch(apiKey);
  const out = { ...adapters };
  for (const id of ["web", "news"] as const) {
    out[id] = {
      ...adapters[id],
      dataProvider: "serper",
      rateLimit: () => ({ key: `serper:${id}`, capacity: 5, refillPerSecond: 2 }),
      configured: () => ({ ok: true }),
      searchMentions: search[id],
    };
  }
  return out;
}
