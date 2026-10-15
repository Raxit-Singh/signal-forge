// API Direct client + connectors against deterministic mock responses shaped
// exactly like the documented examples. No network, no paid calls.
import { test } from "node:test";
import assert from "node:assert/strict";

import { SourceError } from "../errors.ts";
import type { BillingIntent, BillingOutcome, SourceContext, SourceRequest } from "../types.ts";
import { apiDirectError } from "./client.ts";
import { ENDPOINTS, billedUnits, unitsRequested, validateParams } from "./endpoints.ts";
import { createApiDirectAdapters, presetFor, saturation } from "./adapters.ts";
import { headlineKey, normalizeRedditComment, normalizeTweet, parseApiDate, redditPostId } from "./normalizers.ts";
import { prepareIngest } from "../pipeline.ts";

const NOW = new Date("2026-10-15T12:00:00Z");
const WINDOW = { since: new Date("2026-10-14T00:00:00Z"), until: NOW };
const KEY = "ak_live_test_not_real";

interface Call {
  url: URL;
  headers: Record<string, string>;
  billing: BillingIntent;
  outcome?: BillingOutcome;
}

type Route = (u: URL) => { status: number; body: unknown } | undefined;

/** Mock context: records every paid call, its billing intent and how it was settled. */
function paidCtx(routes: Route[], opts: { refuse?: string } = {}) {
  const calls: Call[] = [];
  const cooldowns: number[] = [];
  const ctx: SourceContext = {
    async request() {
      throw new Error("API Direct must only use paidRequest");
    },
    async paidRequest(req: SourceRequest & { billing: BillingIntent }) {
      if (opts.refuse) throw new SourceError("budget", opts.refuse);
      const url = new URL(req.url);
      const call: Call = { url, headers: req.headers ?? {}, billing: req.billing };
      calls.push(call);
      for (const r of routes) {
        const hit = r(url);
        if (hit) {
          return {
            response: new Response(JSON.stringify(hit.body), { status: hit.status, headers: { "content-type": "application/json" } }),
            ledgerId: `ledger-${calls.length}`,
            settle: async (o: BillingOutcome) => {
              assert.equal(call.outcome, undefined, "settled twice");
              call.outcome = o;
            },
          };
        }
      }
      throw new Error(`unexpected ${req.url}`);
    },
    async cooldown(s) {
      cooldowns.push(s);
    },
    now: () => NOW,
  };
  return { ctx, calls, cooldowns };
}

const rule = (term: string) => ({ term, kind: "exact_name" as const, isAmbiguous: false, contextTerms: [], negativeTerms: [], enabled: true });

// ------------------------------------------------------------------ fixtures (doc-shaped)

const redditCommentsPage = {
  posts: [
    {
      title: "techguy on productivity", url: "https://reddit.com/r/productivity/comments/abc123/what_tools_do_you_recommend/",
      date: "2026-10-15 09:30:00", author: "techguy", source: "Reddit (Comment)", domain: "reddit.com", subreddit: "productivity",
      snippet: "I tried FocusFlow and it keeps crashing on my Mac.", type: "comment", upvotes: 12, post_upvotes: 340, post_comments: 88,
    },
    {
      title: "other on webdev", url: "https://www.youtube.com/watch?v=xyz",
      date: "2026-10-15 08:00:00", author: "[deleted]", source: "Reddit (Comment)", domain: "reddit.com", subreddit: "webdev",
      snippet: "FocusFlow is great for pomodoro sessions, highly recommend it to anyone.", type: "comment", upvotes: null, post_upvotes: null, post_comments: null,
    },
  ],
  pages: 1, count: 2,
};

const tweet = (id: string, extra: Record<string, unknown> = {}) => ({
  title: "@dev on X", url: `https://twitter.com/dev/status/${id}`, date: "2026-10-15 10:00:00", author: "dev", source: "Twitter (X)",
  domain: "x.com", snippet: "FocusFlow just shipped dark mode", likes: 10, retweets: 2, replies: 6, quotes: 1, bookmarks: 0, views: 900,
  author_followers: 100, author_verified: false, lang: "en", is_reply: false, is_quote: false, hashtags: [], user_mentions: [], ...extra,
});

// ------------------------------------------------------------------ endpoint catalog

test("parameters are validated against the documented spec", () => {
  const qs = validateParams(ENDPOINTS.redditComments, { query: '"FocusFlow" OR "focusflow.app"', pages: 2, sort_by: "most_recent" });
  assert.equal(qs.get("pages"), "2");
  assert.throws(() => validateParams(ENDPOINTS.redditComments, { query: "x", pages: 11 }), /1-10/);
  assert.throws(() => validateParams(ENDPOINTS.redditPosts, { query: "x", posted_ago: "2d" }), /one of/);
  assert.throws(() => validateParams(ENDPOINTS.redditPosts, { page: 1 }), /required/);
  assert.throws(() => validateParams(ENDPOINTS.redditPosts, { query: "x", bogus: 1 }), /unknown parameter/);
  assert.throws(() => validateParams(ENDPOINTS.xPosts, { query: "a".repeat(501) }), /1-500/);
});

test("billing rules: zero-result 200s are billable, per page requested; most errors are not", () => {
  assert.equal(unitsRequested(ENDPOINTS.redditComments, { pages: 3 }), 3);
  assert.equal(unitsRequested(ENDPOINTS.redditPosts, { page: 5 }), 1, "page endpoints bill per request");
  assert.equal(billedUnits(ENDPOINTS.redditComments, 200, undefined, 3), 3, "answered = billed even with 0 results");
  assert.equal(billedUnits(ENDPOINTS.xPosts, 404, "not_found", 5), 1, "404 bills one request whatever pages");
  assert.equal(billedUnits(ENDPOINTS.xPosts, 429, "concurrency_limit_exceeded", 5), 0);
  assert.equal(billedUnits(ENDPOINTS.xPosts, 502, "upstream_error", 5), 0);
  assert.equal(billedUnits(ENDPOINTS.instagramPostComments, 403, "private_account", 4), 1);
  assert.equal(billedUnits(ENDPOINTS.redditPosts, 400, "invalid_parameter", 1), 0);
});

test("error codes map to retry behaviour", () => {
  assert.equal(apiDirectError(401, { code: "invalid_api_key" }, NOW).kind, "auth");
  assert.equal(apiDirectError(429, { code: "concurrency_limit_exceeded" }, NOW).kind, "rate_limited");
  assert.equal(apiDirectError(429, { code: "monthly_limit_exceeded" }, NOW).kind, "budget");
  assert.equal(apiDirectError(402, { code: "payment_required" }, NOW).kind, "budget");
  assert.equal(apiDirectError(400, { code: "invalid_parameter" }, NOW).kind, "bad_request");
  assert.equal(apiDirectError(504, { code: "upstream_timeout" }, NOW).kind, "transient");
  const daily = apiDirectError(429, { code: "daily_limit_exceeded" }, NOW);
  assert.equal(daily.retryAfterSeconds, 12 * 3600 + 60, "until UTC midnight");
});

test("dates without a zone are read as UTC; unix timestamps win", () => {
  assert.equal(parseApiDate("2026-10-15 09:30:00")!.toISOString(), "2026-10-15T09:30:00.000Z");
  assert.equal(parseApiDate("2025-06-17 19:14:14", 1750187654)!.toISOString(), "2025-06-17T19:14:14.000Z");
  assert.equal(parseApiDate("not a date"), null);
});

// ------------------------------------------------------------------ Reddit

test("Reddit comment search is its own stream: finds a comment whose post doesn't mention the product", async () => {
  const { ctx, calls } = paidCtx([(u) => (u.pathname === "/v1/reddit/comments" ? { status: 200, body: redditCommentsPage } : undefined)]);
  const { reddit } = createApiDirectAdapters(KEY);
  const res = await reddit.searchMentions({ terms: ["FocusFlow"], query: "FocusFlow", window: WINDOW, maxPages: 1, stream: "comments" }, ctx);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url.pathname, "/v1/reddit/comments", "comments use the comment endpoint, not post search");
  assert.equal(calls[0]!.url.searchParams.get("sort_by"), "most_recent");
  assert.equal(calls[0]!.headers["X-API-Key"], KEY);
  assert.ok(!calls[0]!.url.search.includes(KEY), "key never in the URL");
  assert.deepEqual(calls[0]!.billing, { pricingKey: "reddit.comments", units: 1, purpose: "comment_search" });
  assert.deepEqual(calls[0]!.outcome, { billedUnits: 1, results: 2 });

  const [c1, c2] = res.items;
  assert.equal(c1!.mentionType, "comment");
  assert.equal(c1!.parentExternalId, "post:abc123");
  assert.equal(c1!.linkTarget, "thread", "no comment permalink: link opens the thread");
  assert.equal(c1!.community, "r/productivity");
  assert.equal(c1!.originRequestId, "ledger-1");
  assert.equal(c2!.linkTarget, "shared_content", "link post: url is the shared content");
  assert.equal(c2!.authorExternalId, null, "deleted author is not stored");

  // The parent post title ("What tools do you recommend") never mentions FocusFlow; the comment does.
  const prepared = prepareIngest(res.items, [rule("FocusFlow")], { now: NOW });
  assert.equal(prepared.items.length, 2);
  assert.equal(prepared.items[0]!.relevance_status, "relevant");
  assert.equal(prepared.items[0]!.collection_method, "comment_search");
});

test("Reddit comment ids are stable across queries (no double counting) and ignore edits", () => {
  const base = redditCommentsPage.posts[0]!;
  const a = normalizeRedditComment(base)!;
  const b = normalizeRedditComment({ ...base, snippet: "Edited: FocusFlow crashes less now" })!;
  assert.equal(a.externalId, b.externalId);
  const other = normalizeRedditComment({ ...base, author: "someoneelse" })!;
  assert.notEqual(a.externalId, other.externalId);
  assert.equal(redditPostId("https://www.reddit.com/r/x/comments/1AbC9z/title/"), "1abc9z");
  assert.equal(redditPostId("https://example.com/comments/abc"), null);
});

test("Reddit post search pages until the window start and keeps its own stream", async () => {
  const page = (n: number, dateBase: string) => ({
    posts: Array.from({ length: 20 }, (_, i) => ({
      title: `FocusFlow thread ${n}-${i}`, url: `https://reddit.com/r/apps/comments/p${n}x${i}/t/`, date: dateBase,
      author: `u${i}`, subreddit: "apps", snippet: "FocusFlow", upvotes: 1, comments: 0,
    })),
    page: n, count: 20,
  });
  const { ctx, calls } = paidCtx([(u) => {
    if (u.pathname !== "/v1/reddit/posts") return undefined;
    const p = Number(u.searchParams.get("page"));
    return { status: 200, body: page(p, p === 1 ? "2026-10-15 08:00:00" : "2026-10-13 08:00:00") };
  }]);
  const { reddit } = createApiDirectAdapters(KEY);
  const res = await reddit.searchMentions({ terms: ["FocusFlow"], window: WINDOW, maxPages: 3, stream: "posts" }, ctx);
  assert.equal(calls.length, 2, "stops once the oldest result is before the window");
  assert.equal(calls[0]!.url.searchParams.get("posted_ago"), "7d");
  assert.equal(res.complete, true);
  assert.equal(res.saturated, false);
  assert.ok(calls.every((c) => c.billing.units === 1 && c.billing.pricingKey === "reddit.posts"));
});

test("a page cap reached inside the window is reported as saturated and incomplete", () => {
  const items = Array.from({ length: 25 }, () => ({ publishedAt: new Date("2026-10-15T10:00:00Z") })) as never[];
  const v = saturation({ items, returned: 25, pagesRequested: 1 }, WINDOW.since, 25, true);
  assert.deepEqual(v, { complete: false, saturated: true });
  const few = saturation({ items: items.slice(0, 3), returned: 3, pagesRequested: 1 }, WINDOW.since, 25, true);
  assert.deepEqual(few, { complete: true, saturated: false });
});

test("empty search results are still billed and recorded", async () => {
  const { ctx, calls } = paidCtx([() => ({ status: 200, body: { posts: [], pages: 2, count: 0 } })]);
  const { reddit } = createApiDirectAdapters(KEY);
  const res = await reddit.searchMentions({ terms: ["Nothing"], window: WINDOW, maxPages: 2, stream: "comments" }, ctx);
  assert.equal(res.items.length, 0);
  assert.deepEqual(calls[0]!.outcome, { billedUnits: 2, results: 0 });
});

// ------------------------------------------------------------------ X

test("X search finds replies and quotes containing the keyword; date range is sent", async () => {
  const body = { posts: [tweet("1846987139428634858"), tweet("1846987139428634859", { is_reply: true }), tweet("1846987139428634860", { is_quote: true })], pages: 1, count: 3 };
  const { ctx, calls } = paidCtx([(u) => (u.pathname === "/v1/twitter/posts" ? { status: 200, body } : undefined)]);
  const { x } = createApiDirectAdapters(KEY);
  const res = await x.searchMentions({ terms: ["FocusFlow"], window: { since: new Date("2026-10-10T00:00:00Z"), until: NOW }, maxPages: 2 }, ctx);
  assert.equal(calls[0]!.url.searchParams.get("start_date"), "2026-10-10");
  assert.equal(calls[0]!.url.searchParams.get("end_date"), "2026-10-15");
  assert.equal(calls[0]!.billing.units, 2, "pages=2 is billed as 2 pages");
  assert.deepEqual(res.items.map((i) => i.mentionType), ["post", "reply", "quote"]);
  assert.equal(res.items[0]!.sourceUrl, "https://x.com/dev/status/1846987139428634858");
  assert.equal(res.items[0]!.externalId, "tweet:1846987139428634858");
});

test("X reply discovery for selected posts is a separate, separately-costed call", async () => {
  const replies = { comments: [tweet("1846987139428634999", { is_reply: true, snippet: "@dev does FocusFlow sync with iCloud?" })], tweet_id: "1846987139428634858", pages: 1, count: 1 };
  const { ctx, calls } = paidCtx([(u) => (u.pathname === "/v1/twitter/tweet/comments" ? { status: 200, body: replies } : undefined)]);
  const { x } = createApiDirectAdapters(KEY);
  const parent = { externalId: "tweet:1846987139428634858", platformId: "1846987139428634858", sourceUrl: "https://x.com/dev/status/1846987139428634858", title: "FocusFlow just shipped dark mode", commentCount: 6, publishedAt: NOW };
  const res = await x.expandComments!([parent], ctx);
  assert.equal(calls[0]!.url.searchParams.get("tweet_id"), "1846987139428634858");
  assert.equal(calls[0]!.billing.purpose, "reply_expansion");
  assert.equal(res.items[0]!.parentExternalId, "tweet:1846987139428634858");
  assert.equal(res.items[0]!.collectionMethod, "reply_expansion");
  assert.equal(res.complete, false, "never claims complete reply coverage");
});

test("a reply that only replies in a product thread is pending review, not relevant", () => {
  const t = normalizeTweet(tweet("1846987139428635005", { snippet: "same here, it crashes" }) as never, { method: "reply_expansion", parentId: "1846987139428600001", parentText: "FocusFlow keeps crashing" })!;
  const p = prepareIngest([t], [rule("FocusFlow")], { now: NOW });
  assert.equal(p.items[0]!.relevance_status, "pending");
});

// ------------------------------------------------------------------ errors, retries, budgets

test("transient errors are retried (max 3 tries) and unbilled failures settle at zero", async () => {
  let n = 0;
  const { ctx, calls } = paidCtx([() => {
    n++;
    return n < 3 ? { status: 502, body: { error: "Upstream error", code: "upstream_error" } } : { status: 200, body: { posts: [], pages: 1, count: 0 } };
  }]);
  const { reddit } = createApiDirectAdapters(KEY);
  await reddit.searchMentions({ terms: ["FocusFlow"], window: WINDOW, maxPages: 1, stream: "comments" }, ctx);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => c.outcome?.billedUnits), [0, 0, 1]);
});

test("auth errors are not retried", async () => {
  const { ctx, calls } = paidCtx([() => ({ status: 401, body: { error: "Invalid API key", code: "invalid_api_key" } })]);
  const { x } = createApiDirectAdapters(KEY);
  await assert.rejects(x.searchMentions({ terms: ["a"], window: WINDOW, maxPages: 1 }, ctx), (e: unknown) => e instanceof SourceError && e.kind === "auth");
  assert.equal(calls.length, 1);
});

test("account spending limit pauses the source and is reported as a budget stop", async () => {
  const { ctx, cooldowns } = paidCtx([() => ({ status: 429, body: { error: "Monthly spending limit reached", code: "monthly_limit_exceeded", limit: 50, current: 49.97 } })]);
  const { x } = createApiDirectAdapters(KEY);
  await assert.rejects(x.searchMentions({ terms: ["a"], window: WINDOW, maxPages: 1 }, ctx), (e: unknown) => e instanceof SourceError && e.kind === "budget");
  assert.equal(cooldowns.length, 1);
});

test("a refused budget reservation means no request is sent", async () => {
  const { ctx, calls } = paidCtx([() => ({ status: 200, body: { posts: [] } })], { refuse: "workspace allowance used up" });
  const { reddit } = createApiDirectAdapters(KEY);
  await assert.rejects(reddit.searchMentions({ terms: ["a"], window: WINDOW, maxPages: 1, stream: "comments" }, ctx), /allowance/);
  assert.equal(calls.length, 0);
});

test("an unexpected response shape is billed but rejected, never guessed at", async () => {
  const { ctx, calls } = paidCtx([() => ({ status: 200, body: { results: "nope" } })]);
  const { reddit } = createApiDirectAdapters(KEY);
  await assert.rejects(reddit.searchMentions({ terms: ["a"], window: WINDOW, maxPages: 1, stream: "comments" }, ctx), /unexpected response shape/);
  assert.equal(calls[0]!.outcome?.billedUnits, 1);
});

test("without API_DIRECT_API_KEY every paid source reports not configured", () => {
  for (const a of Object.values(createApiDirectAdapters(undefined))) {
    const c = a.configured();
    assert.equal(c.ok, false, a.id);
    assert.equal(a.paid, true);
  }
});

// ------------------------------------------------------------------ other platforms

test("TikTok skips ads; Instagram never claims completeness; web results carry estimated dates", async () => {
  const routes: Route[] = [
    (u) => (u.pathname === "/v1/tiktok/videos" ? { status: 200, body: { videos: [
      { title: "FocusFlow review", url: "https://www.tiktok.com/@a/video/7312345678901234567", date: "2026-10-15 08:00:00", author: "a", snippet: "FocusFlow review", likes: 5, comments: 4, shares: 1, is_ad: false },
      { title: "Buy FocusFlow", url: "https://www.tiktok.com/@b/video/7312345678901234568", date: "2026-10-15 08:00:00", author: "b", snippet: "FocusFlow", is_ad: true },
    ], pages: 1, count: 2 } } : undefined),
    (u) => (u.pathname === "/v1/instagram/posts" ? { status: 200, body: { posts: [], pages: 1, count: 0 } } : undefined),
    (u) => (u.pathname === "/v1/web/search" ? { status: 200, body: { results: [
      { position: 1, rank: 1, title: "FocusFlow review", url: "https://blog.example/focusflow-review?utm_source=x", snippet: "We tried FocusFlow", domain: "blog.example" },
      { position: 2, rank: 2, title: "FocusFlow", url: "https://focusflow.app/", snippet: "Official site", domain: "focusflow.app" },
    ], pages: 1, count: 2 } } : undefined),
  ];
  const { ctx } = paidCtx(routes);
  const a = createApiDirectAdapters(KEY);
  const tt = await a.tiktok.searchMentions({ terms: ["FocusFlow"], window: WINDOW, maxPages: 1 }, ctx);
  assert.equal(tt.items.length, 1);
  const ig = await a.instagram.searchMentions({ terms: ["FocusFlow"], window: WINDOW, maxPages: 1 }, ctx);
  assert.equal(ig.complete, false);
  const web = await a.web.searchMentions({ terms: ["FocusFlow"], window: WINDOW, maxPages: 1, target: { websiteDomain: "focusflow.app" } }, ctx);
  assert.equal(web.items.length, 1, "the product's own site is not a mention");
  assert.equal(web.items[0]!.publishedAtEstimated, true);
  assert.equal(web.complete, false);
});

test("Trustpilot reviews of the product's own page are relevant by construction", async () => {
  const { ctx, calls } = paidCtx([() => ({ status: 200, body: {
    company: { name: "FocusFlow", domain: "focusflow.app" },
    reviews: [{ review_id: "r1", review_link: "https://www.trustpilot.com/reviews/r1", rating: 2, title: "Crashes", review_text: "Keeps crashing", review_datetime_utc: "2026-10-15T08:00:00.000Z", review_timestamp: 1792051200, like_count: 3, author_id: "a1", author_name: "Ann" }],
    count: 1, pages: 1,
  } })]);
  const { trustpilot } = createApiDirectAdapters(KEY);
  const res = await trustpilot.searchMentions({ terms: [], window: WINDOW, maxPages: 1, target: { websiteDomain: "focusflow.app" } }, ctx);
  assert.equal(calls[0]!.url.searchParams.get("domain"), "focusflow.app");
  const p = prepareIngest(res.items, [rule("SomethingElse")], { now: NOW });
  assert.equal(p.items[0]!.relevance_status, "relevant");
  assert.equal(p.items[0]!.mention_type, "review");
  await assert.rejects(trustpilot.searchMentions({ terms: [], window: WINDOW, maxPages: 1 }, ctx), /website domain/);
});

test("syndicated news copies share a headline key", () => {
  assert.equal(headlineKey("FocusFlow raises $5M to fix focus - TechNews"), headlineKey("FocusFlow raises $5M to fix focus | Daily Wire"));
  assert.equal(headlineKey("short"), null);
});

test("posted_ago presets pick the smallest window that covers the request", () => {
  const P: Array<[number, string]> = [[3_600_000, "1h"], [86_400_000, "24h"], [7 * 86_400_000, "7d"]];
  assert.equal(presetFor(30 * 60_000, P), "1h");
  assert.equal(presetFor(26 * 3_600_000, P), "7d");
  assert.equal(presetFor(30 * 86_400_000, P), undefined);
});
