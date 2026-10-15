// Hacker News via the official Algolia-hosted search API (hn.algolia.com/api).
// No key. Documented limit: 10,000 requests/hour per IP; we budget far less.

import { SourceError, httpError } from "./errors.ts";
import { canonicalLink, excerpt, htmlToText, sum } from "./text.ts";
import type { CandidateMention, SearchRequest, SearchResult, SourceAdapter, SourceContext } from "./types.ts";

const API = "https://hn.algolia.com/api/v1";
const HITS_PER_PAGE = 100;

export interface HnHit {
  objectID: string;
  _tags?: string[];
  author?: string | null;
  created_at_i: number;
  title?: string | null;
  url?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  story_id?: number | null;
  story_title?: string | null;
  story_url?: string | null;
  parent_id?: number | null;
  points?: number | null;
  num_comments?: number | null;
}

interface HnResponse {
  hits: HnHit[];
  nbHits: number;
  nbPages: number;
  page: number;
}

/** Quotes multi-word / punctuated terms so Algolia treats them as phrases. */
export function hnQuery(term: string): string {
  const t = term.replace(/"/g, "").trim();
  return /[\s./-]/.test(t) ? `"${t}"` : t;
}

export function normalizeHnHit(hit: HnHit): CandidateMention | null {
  if (!hit.objectID || !Number.isFinite(hit.created_at_i)) return null;
  const isComment = hit._tags?.includes("comment") ?? Boolean(hit.comment_text);
  const body = htmlToText(isComment ? hit.comment_text : hit.story_text);
  const title = isComment ? (hit.story_title ? `Re: ${hit.story_title}` : null) : (hit.title ?? null);
  const points = isComment ? undefined : hit.points ?? undefined;
  const comments = isComment ? undefined : hit.num_comments ?? undefined;
  const engagement: Record<string, number> = {};
  if (typeof points === "number") engagement.points = points;
  if (typeof comments === "number") engagement.comments = comments;

  return {
    externalId: hit.objectID,
    sourceUrl: `https://news.ycombinator.com/item?id=${encodeURIComponent(hit.objectID)}`,
    parentExternalId: hit.story_id && String(hit.story_id) !== hit.objectID ? String(hit.story_id) : null,
    authorExternalId: hit.author ?? null,
    authorDisplay: hit.author ?? null,
    title,
    content: excerpt(body),
    publishedAt: new Date(hit.created_at_i * 1000),
    engagement,
    engagementScore: sum([points, comments]),
    linkedUrl: isComment ? null : canonicalLink(hit.url),
    matchText: [isComment ? null : hit.title, body, isComment ? null : hit.url].filter(Boolean).join("\n"),
    // A comment in a thread about the product is weaker evidence than naming it.
    contextText: isComment ? [hit.story_title, hit.story_url].filter(Boolean).join("\n") || null : null,
  };
}

export const hackerNews: SourceAdapter = {
  id: "hackernews",
  name: "Hacker News",
  configured: () => ({ ok: true }),
  rateLimit: () => ({ key: "hackernews", capacity: 30, refillPerSecond: 1 }),

  async searchMentions(req: SearchRequest, ctx: SourceContext): Promise<SearchResult> {
    const since = Math.floor(req.window.since.getTime() / 1000);
    const until = Math.floor(req.window.until.getTime() / 1000);
    const items = new Map<string, CandidateMention>();
    let complete = true;
    let reason: string | undefined;

    for (const term of req.terms) {
      for (let page = 0; page < req.maxPages; page++) {
        const params = new URLSearchParams({
          query: hnQuery(term),
          tags: "(story,comment)",
          numericFilters: `created_at_i>=${since},created_at_i<${until}`,
          hitsPerPage: String(HITS_PER_PAGE),
          page: String(page),
        });
        const res = await ctx.request({ url: `${API}/search_by_date?${params}`, endpoint: "search_by_date", signal: req.signal });
        if (!res.ok) throw httpError("Hacker News", res);
        const body = (await res.json()) as HnResponse;
        if (!Array.isArray(body.hits)) throw new SourceError("transient", "Hacker News: unexpected response shape");
        for (const hit of body.hits) {
          const m = normalizeHnHit(hit);
          if (m) items.set(m.externalId, m);
        }
        if (page + 1 >= body.nbPages) break;
        if (page + 1 >= req.maxPages) {
          complete = false;
          reason = `More than ${req.maxPages * HITS_PER_PAGE} results for "${term}"; only the newest were collected.`;
        }
      }
    }
    return { items: [...items.values()], complete, incompleteReason: reason };
  },

  async validateCredentials(ctx) {
    const res = await ctx.request({ url: `${API}/search_by_date?query=test&hitsPerPage=1`, endpoint: "search_by_date" });
    if (!res.ok) throw httpError("Hacker News", res);
  },
};
