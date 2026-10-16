// Stack Exchange API 2.3 — `/search/excerpts` returns questions and answers.
// Without a key: 300 requests/day per IP. With a (free) Stack Apps key:
// 10,000/day. Responses may carry `backoff` (seconds); it must be honoured.

import { SourceError, httpError, secondsUntilUtcMidnight } from "./errors.ts";
import { decodeEntities, excerpt, htmlToText, sum } from "./text.ts";
import type { CandidateMention, SearchRequest, SearchResult, SourceAdapter, SourceContext } from "./types.ts";

const API = "https://api.stackexchange.com/2.3";
const PAGE_SIZE = 100;

export interface SeExcerpt {
  item_type: "question" | "answer";
  question_id: number;
  answer_id?: number;
  title?: string;
  body?: string;
  excerpt?: string;
  creation_date: number;
  score?: number;
  answer_count?: number;
  tags?: string[];
}

interface SeResponse {
  items?: SeExcerpt[];
  has_more?: boolean;
  quota_max?: number;
  quota_remaining?: number;
  backoff?: number;
  error_id?: number;
  error_name?: string;
  error_message?: string;
}

export function normalizeSeItem(item: SeExcerpt, site = "stackoverflow"): CandidateMention | null {
  if (!item?.question_id || !Number.isFinite(item.creation_date)) return null;
  const isAnswer = item.item_type === "answer" && item.answer_id;
  const host = site === "stackoverflow" ? "stackoverflow.com" : `${site}.stackexchange.com`;
  const id = isAnswer ? `a:${item.answer_id}` : `q:${item.question_id}`;
  const title = item.title ? decodeEntities(item.title) : null;
  const body = htmlToText(item.body ?? item.excerpt ?? "");
  const score = item.score ?? 0;
  const answers = isAnswer ? undefined : item.answer_count;
  const engagement: Record<string, number> = { score };
  if (typeof answers === "number") engagement.answers = answers;
  return {
    externalId: `${site}:${id}`,
    sourceUrl: isAnswer ? `https://${host}/a/${item.answer_id}` : `https://${host}/q/${item.question_id}`,
    parentExternalId: isAnswer ? `${site}:q:${item.question_id}` : null,
    // The excerpts endpoint does not return the author.
    authorExternalId: null,
    authorDisplay: null,
    title: isAnswer && title ? `Answer: ${title}` : title,
    content: excerpt(body),
    publishedAt: new Date(item.creation_date * 1000),
    engagement,
    engagementScore: sum([score, answers]),
    linkedUrl: null,
    matchText: isAnswer ? body : `${title ?? ""}\n${body}`,
    contextText: isAnswer ? title : (item.tags ?? []).join(" ") || null,
  };
}

export function createStackExchangeAdapter(key?: string): SourceAdapter {
  async function call(ctx: SourceContext, params: URLSearchParams, signal?: AbortSignal): Promise<SeResponse> {
    if (key) params.set("key", key);
    const res = await ctx.request({ url: `${API}/search/excerpts?${params}`, endpoint: "search/excerpts", signal });
    let body: SeResponse;
    try {
      body = (await res.json()) as SeResponse;
    } catch {
      throw httpError("Stack Exchange", res);
    }
    if (typeof body.backoff === "number" && body.backoff > 0) await ctx.cooldown(body.backoff);
    if (body.error_id) {
      // 502 throttle_violation, 503 temporarily_unavailable; quota exhaustion is also 502.
      if (body.error_id === 502 && /quota/i.test(body.error_message ?? "")) {
        const wait = secondsUntilUtcMidnight(ctx.now());
        await ctx.cooldown(wait);
        throw new SourceError("quota", "Stack Exchange: daily quota exhausted", { retryAfterSeconds: wait });
      }
      if (body.error_id === 502) {
        // e.g. "too many requests from this IP, more requests available in 3600 seconds"
        const wait = Number(/(\d+)\s*seconds/i.exec(body.error_message ?? "")?.[1] ?? 60);
        await ctx.cooldown(wait);
        throw new SourceError("rate_limited", `Stack Exchange: ${body.error_message ?? "throttled"}`, { retryAfterSeconds: wait });
      }
      if (body.error_id === 503) throw new SourceError("transient", "Stack Exchange: temporarily unavailable", { retryAfterSeconds: 120 });
      if (body.error_id === 400 && /key/i.test(body.error_message ?? "")) throw new SourceError("auth", "Stack Exchange: invalid key");
      throw new SourceError(body.error_id >= 500 ? "transient" : "bad_request", `Stack Exchange: ${body.error_name ?? "error"} (${body.error_id})`);
    }
    if (!res.ok) throw httpError("Stack Exchange", res);
    if (body.quota_remaining === 0) await ctx.cooldown(secondsUntilUtcMidnight(ctx.now()));
    return body;
  }

  return {
    id: "stackexchange",
    name: "Stack Overflow / Stack Exchange",
    configured: () => ({ ok: true }),
    // Daily quota spread over the day; burst of 20.
    rateLimit: () => (key
      ? { key: "stackexchange:key", capacity: 20, refillPerSecond: 9000 / 86_400 }
      : { key: "stackexchange:anon", capacity: 20, refillPerSecond: 280 / 86_400 }),

    async searchMentions(req: SearchRequest, ctx: SourceContext): Promise<SearchResult> {
      const items = new Map<string, CandidateMention>();
      let complete = true;
      let reason: string | undefined;
      let quota: SeResponse | undefined;
      let pagesRequested = 0;
      for (const term of req.terms) {
        for (let page = 1; page <= req.maxPages; page++) {
          const params = new URLSearchParams({
            order: "desc",
            sort: "creation",
            q: term,
            site: "stackoverflow",
            fromdate: String(Math.floor(req.window.since.getTime() / 1000)),
            todate: String(Math.floor(req.window.until.getTime() / 1000) - 1),
            pagesize: String(PAGE_SIZE),
            page: String(page),
          });
          const body = await call(ctx, params, req.signal);
          pagesRequested++;
          quota = body;
          for (const it of body.items ?? []) {
            const m = normalizeSeItem(it);
            if (m) items.set(m.externalId, m);
          }
          if (!body.has_more) break;
          if (page === req.maxPages) {
            complete = false;
            reason = `More than ${req.maxPages * PAGE_SIZE} results for "${term}"; only the newest were collected.`;
          }
        }
      }
      return {
        items: [...items.values()],
        complete,
        incompleteReason: reason,
        rateLimit: quota ? { remaining: quota.quota_remaining, limit: quota.quota_max } : undefined,
        pagesRequested,
      };
    },

    async validateCredentials(ctx) {
      await call(ctx, new URLSearchParams({ site: "stackoverflow", q: "test", pagesize: "1" }));
    },
  };
}
