// API Direct connectors (paid). One adapter per platform; multi-stream
// platforms (Reddit posts/comments, Substack posts/notes) keep a separate
// checkpoint per stream. Nothing here runs without API_DIRECT_API_KEY, and the
// server additionally requires a global budget and PAID_SOURCES_ENABLED.

import { SourceError } from "../errors.ts";
import { CAPS } from "../capabilities.ts";
import type {
  CandidateMention, ExpansionParent, PaidSourceId, SearchRequest, SearchResult, SourceAdapter, SourceContext, StreamSpec,
} from "../types.ts";
import { apiDirectGet } from "./client.ts";
import { ENDPOINTS, type Params } from "./endpoints.ts";
import {
  instagramShortcode, normalizeFacebookComment, normalizeFacebookPost, normalizeInstagramComment, normalizeInstagramPost,
  normalizeLinkedinPost, normalizeNewsArticle, normalizeRedditComment, normalizeRedditPost, normalizeSubstackNote,
  normalizeSubstackPost, normalizeTiktokComment, normalizeTiktokVideo, normalizeTrustpilotReview, normalizeTweet,
  normalizeWebResult, tiktokVideoId,
} from "./normalizers.ts";
import * as S from "./schemas.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Smallest documented "posted_ago" preset that covers the window; undefined = all time. */
export function presetFor<T extends string>(windowMs: number, presets: Array<[number, T]>): T | undefined {
  for (const [ms, value] of presets) if (windowMs <= ms) return value;
  return undefined;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

function queryOf(req: SearchRequest): string {
  const q = (req.query ?? req.terms.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(" OR ")).trim();
  if (!q) throw new SourceError("bad_request", "Empty query");
  return q.slice(0, 500);
}

function pagesFor(req: SearchRequest, max: number): number {
  return Math.max(1, Math.min(max, Math.floor(req.maxPages)));
}

/** Page offset to start from (continuations of page-resumable searches), within the provider's range. */
function firstPage(req: SearchRequest, providerMax: number): number {
  return Math.max(1, Math.min(providerMax, Math.floor(req.startPage ?? 1)));
}

interface Collected {
  items: CandidateMention[];
  /** Items the API returned (before normalization). */
  returned: number;
  pagesRequested: number;
}

/**
 * Coverage verdict for a newest-first result set: if the oldest item is still
 * inside the window and pages came back (nearly) full, more results probably
 * exist beyond the page cap — the run is partial and "saturated".
 */
export function saturation(c: Collected, since: Date, perPage: number, sortedNewest: boolean): { complete: boolean; saturated: boolean } {
  const full = c.returned >= Math.floor(c.pagesRequested * perPage * 0.8);
  if (!full) return { complete: sortedNewest, saturated: false };
  if (!sortedNewest) return { complete: false, saturated: true };
  const oldest = c.items.reduce<number>((m, i) => Math.min(m, i.publishedAt.getTime()), Infinity);
  const reachedBoundary = Number.isFinite(oldest) && oldest < since.getTime();
  return { complete: reachedBoundary, saturated: !reachedBoundary };
}

function keep<T>(xs: Array<T | null>): T[] {
  return xs.filter((x): x is T => x !== null);
}

function tag(items: CandidateMention[], ledgerId: string | null): CandidateMention[] {
  for (const i of items) i.originRequestId = ledgerId;
  return items;
}

function result(c: Collected, verdict: { complete: boolean; saturated: boolean }, why: string): SearchResult {
  return {
    items: c.items,
    complete: verdict.complete,
    saturated: verdict.saturated,
    pagesRequested: c.pagesRequested,
    incompleteReason: verdict.complete ? undefined : why,
  };
}

const notConfigured = { ok: false as const, reason: "API_DIRECT_API_KEY is not set on the server." };

function base(id: PaidSourceId, name: string, key: string | undefined, streams: StreamSpec[]): Omit<SourceAdapter, "searchMentions" | "validateCredentials"> {
  return {
    id,
    name,
    dataProvider: "apidirect",
    paid: true,
    shareable: true,
    streams,
    configured: () => (key ? { ok: true } : notConfigured),
    // API Direct allows 10 concurrent requests per endpoint; the bucket keeps us well below.
    rateLimit: () => ({ key: `apidirect:${id}`, capacity: 6, refillPerSecond: 2 }),
  };
}

/** Validation of a paid key costs money, so it is only run from the authorized live-test script. */
function validateWith(key: string | undefined) {
  return async (ctx: SourceContext) => {
    if (!key) throw new SourceError("auth", notConfigured.reason);
    await apiDirectGet(ctx, key, ENDPOINTS.redditPosts, { query: "signalforge", page: 1, sort_by: "most_recent", posted_ago: "24h" },
      S.redditPostsResponse, "live_test");
  };
}

export function createApiDirectAdapters(apiKey?: string): Record<PaidSourceId, SourceAdapter> {
  const key = apiKey || undefined;
  const need = () => {
    if (!key) throw new SourceError("auth", notConfigured.reason);
    return key;
  };

  // ------------------------------------------------------------- Reddit
  const reddit: SourceAdapter = {
    ...base("reddit", "Reddit", key, [
      { id: "posts", label: "Posts", mentionType: "post", capabilities: CAPS.redditPosts, queryMode: "keywords" },
      { id: "comments", label: "Comments", mentionType: "comment", capabilities: CAPS.redditComments, queryMode: "keywords" },
    ]),
    async searchMentions(req, ctx) {
      const k = need();
      const q = queryOf(req);
      if (req.stream === "comments") {
        // Global comment search: finds comments that mention the product even when the post doesn't.
        const pages = pagesFor(req, CAPS.redditComments.maxPagesPerRun);
        const r = await apiDirectGet(ctx, k, ENDPOINTS.redditComments, { query: q, pages, sort_by: "most_recent" },
          S.redditCommentsResponse, "comment_search", req.signal);
        const c = { items: tag(keep(r.body.posts.map(normalizeRedditComment)), r.ledgerId), returned: r.body.posts.length, pagesRequested: pages };
        return result(c, saturation(c, req.window.since, 25, true),
          `Reddit comment search hit the ${pages}-page limit before reaching the start of the window.`);
      }
      const posted_ago = presetFor(req.window.until.getTime() - req.window.since.getTime(),
        [[HOUR, "1h"], [DAY, "24h"], [7 * DAY, "7d"], [30 * DAY, "30d"], [365 * DAY, "12m"]] as Array<[number, "1h" | "24h" | "7d" | "30d" | "12m"]>);
      const max = pagesFor(req, CAPS.redditPosts.maxPagesPerRun);
      const first = firstPage(req, 12);
      const c: Collected = { items: [], returned: 0, pagesRequested: 0 };
      for (let page = first; page < first + max && page <= 12; page++) {
        const r = await apiDirectGet(ctx, k, ENDPOINTS.redditPosts, { query: q, page, sort_by: "most_recent", posted_ago },
          S.redditPostsResponse, "search", req.signal);
        c.pagesRequested++;
        c.returned += r.body.posts.length;
        const items = tag(keep(r.body.posts.map(normalizeRedditPost)), r.ledgerId);
        c.items.push(...items);
        const oldest = Math.min(...items.map((i) => i.publishedAt.getTime()));
        if (r.body.posts.length < 20 || oldest < req.window.since.getTime()) break;
      }
      return result(c, saturation(c, req.window.since, 20, true), `Reddit post search hit the ${max}-page limit before reaching the start of the window.`);
    },
    validateCredentials: validateWith(key),
  };

  // ------------------------------------------------------------- X
  const x: SourceAdapter = {
    ...base("x", "X (Twitter)", key, [
      { id: "posts", label: "Posts, replies and quotes", mentionType: "post", capabilities: CAPS.xPosts, queryMode: "keywords" },
    ]),
    async searchMentions(req, ctx) {
      const k = need();
      // X search covers replies and quote posts that contain the keywords (flagged is_reply / is_quote).
      const pages = pagesFor(req, CAPS.xPosts.maxPagesPerRun);
      const params: Params = { query: queryOf(req), pages, sort_by: "most_recent" };
      if (req.window.until.getTime() - req.window.since.getTime() <= DAY) params.posted_ago = "24h";
      else {
        params.start_date = utcDay(req.window.since);
        params.end_date = utcDay(req.window.until);
      }
      const r = await apiDirectGet(ctx, k, ENDPOINTS.xPosts, params, S.xPostsResponse, "search", req.signal);
      const c = { items: tag(keep(r.body.posts.map((t) => normalizeTweet(t))), r.ledgerId), returned: r.body.posts.length, pagesRequested: pages };
      return result(c, saturation(c, req.window.since, 20, true), `X search hit the ${pages}-page limit before reaching the start of the window.`);
    },
    async expandComments(parents, ctx, signal) {
      const k = need();
      const items: CandidateMention[] = [];
      let pagesRequested = 0;
      for (const p of parents) {
        // Replies to a selected post (X has no global reply search beyond keyword matches).
        const r = await apiDirectGet(ctx, k, ENDPOINTS.xTweetComments, { tweet_id: p.platformId, pages: 1 }, S.xCommentsResponse, "reply_expansion", signal);
        pagesRequested++;
        items.push(...tag(keep(r.body.comments.map((t) => normalizeTweet(t, { method: "reply_expansion", parentId: p.platformId, parentText: p.title }))), r.ledgerId));
      }
      return { items, complete: false, pagesRequested, incompleteReason: "Replies are fetched for selected posts only." };
    },
    validateCredentials: validateWith(key),
  };

  // ------------------------------------------------------------- LinkedIn
  const linkedin: SourceAdapter = {
    ...base("linkedin", "LinkedIn", key, [
      { id: "posts", label: "Public posts", mentionType: "post", capabilities: CAPS.linkedinPosts, queryMode: "keywords" },
    ]),
    async searchMentions(req, ctx) {
      const k = need();
      const posted_ago = presetFor(req.window.until.getTime() - req.window.since.getTime(),
        [[DAY, "24h"], [7 * DAY, "7d"], [30 * DAY, "30d"]] as Array<[number, "24h" | "7d" | "30d"]>);
      const max = pagesFor(req, CAPS.linkedinPosts.maxPagesPerRun);
      const first = firstPage(req, 25);
      const c: Collected = { items: [], returned: 0, pagesRequested: 0 };
      for (let page = first; page < first + max && page <= 25; page++) {
        const r = await apiDirectGet(ctx, k, ENDPOINTS.linkedinPosts, { query: queryOf(req), page, sort_by: "most_recent", posted_ago },
          S.linkedinPostsResponse, "search", req.signal);
        c.pagesRequested++;
        c.returned += r.body.posts.length;
        const items = tag(keep(r.body.posts.map(normalizeLinkedinPost)), r.ledgerId);
        c.items.push(...items);
        if (r.body.posts.length < 20 || Math.min(...items.map((i) => i.publishedAt.getTime())) < req.window.since.getTime()) break;
      }
      return result(c, saturation(c, req.window.since, 20, true), `LinkedIn search hit the ${max}-page limit before reaching the start of the window.`);
    },
    validateCredentials: validateWith(key),
  };

  // ------------------------------------------------------------- TikTok
  const tiktok: SourceAdapter = {
    ...base("tiktok", "TikTok", key, [
      { id: "videos", label: "Videos", mentionType: "video", capabilities: CAPS.tiktokVideos, queryMode: "keywords" },
    ]),
    async searchMentions(req, ctx) {
      const k = need();
      const pages = pagesFor(req, CAPS.tiktokVideos.maxPagesPerRun);
      const publish_time = presetFor(req.window.until.getTime() - req.window.since.getTime(),
        [[DAY, "1"], [7 * DAY, "7"], [30 * DAY, "30"], [90 * DAY, "90"], [180 * DAY, "180"]] as Array<[number, "1" | "7" | "30" | "90" | "180"]>) ?? "0";
      const r = await apiDirectGet(ctx, k, ENDPOINTS.tiktokVideos, { query: queryOf(req), pages, publish_time, sort_by: "most_recent" },
        S.tiktokVideosResponse, "search", req.signal);
      const c = { items: tag(keep(r.body.videos.map(normalizeTiktokVideo)), r.ledgerId), returned: r.body.videos.length, pagesRequested: pages };
      // TikTok keyword search matches loosely; results are filtered locally.
      // Page size: the live test (2026-10-16) returned 28 videos for one page (docs gave no size); 10 flagged half-empty pages as full.
      return result(c, saturation(c, req.window.since, 25, true), `TikTok search hit the ${pages}-page limit before reaching the start of the window.`);
    },
    async expandComments(parents, ctx, signal) {
      const k = need();
      const items: CandidateMention[] = [];
      for (const p of parents) {
        const r = await apiDirectGet(ctx, k, ENDPOINTS.tiktokVideoComments, { video_id: p.platformId, pages: 1 }, S.tiktokCommentsResponse, "comment_expansion", signal);
        items.push(...tag(keep(r.body.comments.map((cm) => normalizeTiktokComment(cm, p))), r.ledgerId));
      }
      return { items, complete: false, pagesRequested: parents.length, incompleteReason: "TikTok exposes no comment search; comments are read on selected videos only." };
    },
    validateCredentials: validateWith(key),
  };

  // ------------------------------------------------------------- Instagram
  const instagram: SourceAdapter = {
    ...base("instagram", "Instagram", key, [
      { id: "posts", label: "Public posts", mentionType: "post", capabilities: CAPS.instagramPosts, queryMode: "keywords" },
    ]),
    async searchMentions(req, ctx) {
      const k = need();
      const pages = pagesFor(req, CAPS.instagramPosts.maxPagesPerRun);
      const r = await apiDirectGet(ctx, k, ENDPOINTS.instagramPosts, { query: queryOf(req).replace(/^[#@]+/, ""), pages },
        S.instagramPostsResponse, "search", req.signal);
      const c = { items: tag(keep(r.body.posts.map(normalizeInstagramPost)), r.ledgerId), returned: r.body.posts.length, pagesRequested: pages };
      return {
        items: c.items, complete: false, saturated: saturation(c, req.window.since, 10, false).saturated, pagesRequested: pages,
        incompleteReason: "Instagram search is relevance-ranked with no date filter, so it can't guarantee every new post is found.",
      };
    },
    async expandComments(parents, ctx, signal) {
      const k = need();
      const items: CandidateMention[] = [];
      for (const p of parents) {
        const r = await apiDirectGet(ctx, k, ENDPOINTS.instagramPostComments, { code: p.platformId, pages: 1, sort_by: "recent" },
          S.instagramCommentsResponse, "comment_expansion", signal);
        items.push(...tag(keep(r.body.comments.map((cm) => normalizeInstagramComment(cm, p))), r.ledgerId));
      }
      return { items, complete: false, pagesRequested: parents.length, incompleteReason: "Instagram exposes no comment search; comments are read on selected posts only." };
    },
    validateCredentials: validateWith(key),
  };

  // ------------------------------------------------------------- Facebook
  const facebook: SourceAdapter = {
    ...base("facebook", "Facebook", key, [
      { id: "posts", label: "Public posts", mentionType: "post", capabilities: CAPS.facebookPosts, queryMode: "keywords" },
    ]),
    async searchMentions(req, ctx) {
      const k = need();
      const pages = pagesFor(req, CAPS.facebookPosts.maxPagesPerRun);
      const r = await apiDirectGet(ctx, k, ENDPOINTS.facebookPosts,
        { query: queryOf(req), pages, sort_by: "most_recent", start_date: utcDay(req.window.since), end_date: utcDay(req.window.until) },
        S.facebookPostsResponse, "search", req.signal);
      const c = { items: tag(keep(r.body.posts.map(normalizeFacebookPost)), r.ledgerId), returned: r.body.posts.length, pagesRequested: pages };
      return result(c, saturation(c, req.window.since, 20, true), `Facebook search hit the ${pages}-page limit before reaching the start of the window.`);
    },
    async expandComments(parents, ctx, signal) {
      const k = need();
      const items: CandidateMention[] = [];
      for (const p of parents) {
        const r = await apiDirectGet(ctx, k, ENDPOINTS.facebookPostComments, { post_id: p.platformId, pages: 1 }, S.facebookCommentsResponse, "comment_expansion", signal);
        items.push(...tag(keep(r.body.comments.map((cm) => normalizeFacebookComment(cm, p))), r.ledgerId));
      }
      return { items, complete: false, pagesRequested: parents.length, incompleteReason: "Facebook exposes no comment search; comments are read on selected posts only." };
    },
    validateCredentials: validateWith(key),
  };

  // ------------------------------------------------------------- Substack
  const substack: SourceAdapter = {
    ...base("substack", "Substack", key, [
      { id: "posts", label: "Posts", mentionType: "article", capabilities: CAPS.substackPosts, queryMode: "keywords" },
      { id: "notes", label: "Notes", mentionType: "note", capabilities: CAPS.substackNotes, queryMode: "keywords" },
    ]),
    async searchMentions(req, ctx) {
      const k = need();
      if (req.stream === "notes") {
        const pages = pagesFor(req, CAPS.substackNotes.maxPagesPerRun);
        const r = await apiDirectGet(ctx, k, ENDPOINTS.substackNotes, { query: queryOf(req), pages, sort_by: "most_recent" },
          S.substackNotesResponse, "search", req.signal);
        const c = { items: tag(keep(r.body.notes.map(normalizeSubstackNote)), r.ledgerId), returned: r.body.notes.length, pagesRequested: pages };
        return result(c, saturation(c, req.window.since, 5, true), `Substack notes search hit the ${pages}-page limit before reaching the start of the window.`);
      }
      const posted_ago = presetFor(req.window.until.getTime() - req.window.since.getTime(),
        [[DAY, "24h"], [7 * DAY, "7d"], [30 * DAY, "30d"], [365 * DAY, "12m"]] as Array<[number, "24h" | "7d" | "30d" | "12m"]>);
      const max = pagesFor(req, CAPS.substackPosts.maxPagesPerRun);
      const first = firstPage(req, 101);
      const c: Collected = { items: [], returned: 0, pagesRequested: 0 };
      let more = false;
      for (let page = first; page < first + max && page <= 101; page++) {
        const r = await apiDirectGet(ctx, k, ENDPOINTS.substackPosts, { query: queryOf(req), page, posted_ago }, S.substackPostsResponse, "search", req.signal);
        c.pagesRequested++;
        c.returned += r.body.posts.length;
        c.items.push(...tag(keep(r.body.posts.map(normalizeSubstackPost)), r.ledgerId));
        more = Boolean(r.body.has_next_page);
        if (!more) break;
      }
      // Post search is relevance-ranked; has_next_page tells us whether results were left behind.
      return {
        items: c.items, complete: !more, saturated: more, pagesRequested: c.pagesRequested,
        incompleteReason: more ? `Substack post search has more than ${max} pages of results; only the most relevant were collected.` : undefined,
      };
    },
    validateCredentials: validateWith(key),
  };

  // ------------------------------------------------------------- Google web
  const web: SourceAdapter = {
    ...base("web", "Web (Google Search)", key, [
      { id: "results", label: "Web pages", mentionType: "article", capabilities: CAPS.webSearch, queryMode: "keywords" },
    ]),
    async searchMentions(req, ctx) {
      const k = need();
      const span = req.window.until.getTime() - req.window.since.getTime();
      const time = presetFor(span, [[HOUR, "hour"], [DAY, "day"], [7 * DAY, "week"], [31 * DAY, "month"], [365 * DAY, "year"]] as Array<[number, "hour" | "day" | "week" | "month" | "year"]>) ?? "any";
      const pages = pagesFor(req, CAPS.webSearch.maxPagesPerRun);
      const r = await apiDirectGet(ctx, k, ENDPOINTS.webSearch, { query: queryOf(req), pages, time }, S.webSearchResponse, "search", req.signal);
      const now = ctx.now();
      const items = tag(keep(r.body.results.map((x) => normalizeWebResult(x, now, req.target?.websiteDomain))), r.ledgerId);
      return {
        items, complete: false, saturated: r.body.results.length >= pages * 10 * 0.8, pagesRequested: pages,
        incompleteReason: "Web search returns ranked results without publication dates, not a complete feed.",
      };
    },
    validateCredentials: validateWith(key),
  };

  // ------------------------------------------------------------- Google News
  const news: SourceAdapter = {
    ...base("news", "News (Google News)", key, [
      { id: "articles", label: "News articles", mentionType: "article", capabilities: CAPS.newsArticles, queryMode: "keywords" },
    ]),
    async searchMentions(req, ctx) {
      const k = need();
      const span = req.window.until.getTime() - req.window.since.getTime();
      const time_published = presetFor(span, [[HOUR, "1h"], [DAY, "1d"], [7 * DAY, "7d"], [365 * DAY, "1y"]] as Array<[number, "1h" | "1d" | "7d" | "1y"]>) ?? "anytime";
      const limit = 50;
      const r = await apiDirectGet(ctx, k, ENDPOINTS.newsArticles, { query: queryOf(req), limit, time_published }, S.newsArticlesResponse, "search", req.signal);
      const items = tag(keep(r.body.articles.map((a) => normalizeNewsArticle(a, req.target?.websiteDomain))), r.ledgerId);
      const saturated = r.body.articles.length >= limit;
      return {
        items, complete: !saturated, saturated, pagesRequested: 1,
        incompleteReason: saturated ? `News search returned its ${limit}-article maximum; more articles may exist.` : undefined,
      };
    },
    validateCredentials: validateWith(key),
  };

  // ------------------------------------------------------------- Trustpilot
  const trustpilot: SourceAdapter = {
    ...base("trustpilot", "Trustpilot", key, [
      { id: "reviews", label: "Reviews of your business page", mentionType: "review", capabilities: CAPS.trustpilotReviews, queryMode: "product" },
    ]),
    // Reviews are tied to the product's own website domain; nothing to share across products.
    shareable: false,
    async searchMentions(req, ctx) {
      const k = need();
      const domain = req.target?.websiteDomain;
      if (!domain) throw new SourceError("bad_request", "Trustpilot needs the product's website domain.");
      const pages = pagesFor(req, CAPS.trustpilotReviews.maxPagesPerRun);
      const posted_ago = presetFor(req.window.until.getTime() - req.window.since.getTime(),
        [[30 * DAY, "30d"], [91 * DAY, "3m"], [182 * DAY, "6m"], [365 * DAY, "12m"]] as Array<[number, "30d" | "3m" | "6m" | "12m"]>);
      const r = await apiDirectGet(ctx, k, ENDPOINTS.trustpilotReviews, { domain, pages, sort_by: "newest", posted_ago },
        S.trustpilotReviewsResponse, "review_fetch", req.signal);
      const c = { items: tag(keep(r.body.reviews.map((rv) => normalizeTrustpilotReview(rv, domain))), r.ledgerId), returned: r.body.reviews.length, pagesRequested: pages };
      return result(c, saturation(c, req.window.since, 20, true), `Trustpilot returned ${pages} full page(s); older reviews in the window may remain.`);
    },
    validateCredentials: validateWith(key),
  };

  return { reddit, x, linkedin, tiktok, instagram, facebook, substack, web, news, trustpilot };
}

/** Platform id used by each comment endpoint, from a stored/candidate parent. */
export function expansionParentOf(platform: PaidSourceId, m: CandidateMention): ExpansionParent | null {
  const comments = m.engagement.comments ?? m.engagement.replies ?? 0;
  let platformId: string | null = null;
  if (platform === "x" && m.externalId.startsWith("tweet:")) platformId = m.externalId.slice(6);
  if (platform === "tiktok") platformId = tiktokVideoId(m.sourceUrl);
  if (platform === "instagram") platformId = instagramShortcode(m.sourceUrl);
  if (platform === "facebook" && m.externalId.startsWith("post:")) platformId = m.externalId.slice(5);
  if (!platformId) return null;
  const count = platform === "x" ? (m.engagement.replies ?? 0) : comments;
  return {
    externalId: m.externalId, platformId, sourceUrl: m.sourceUrl,
    title: m.title && !/ on (X|TikTok|Instagram|Facebook)$/.test(m.title) ? m.title : m.content?.slice(0, 300) ?? null,
    commentCount: count, publishedAt: m.publishedAt,
  };
}
