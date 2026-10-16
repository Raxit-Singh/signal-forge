// Query optimizer, shared query registry, adaptive scheduling, Launch Boost,
// comment expansion and the free official connectors (with fixtures).
import { test } from "node:test";
import assert from "node:assert/strict";

import { CAPS } from "./capabilities.ts";
import { normalizeExpression, planQueries, queryFingerprint, type OptimizerKeyword } from "./query-optimizer.ts";
import { selectExpansions } from "./expansion.ts";
import { appStoreIds, bluesky, bskyPostUrl, devTag, flattenDevComments, normalizeAppStoreEntry, normalizeBskyPost } from "./official.ts";
import type { SourceContext, SourceRequest } from "./types.ts";

const NOW = new Date("2026-10-15T12:00:00Z");
const kw = (term: string, kind: OptimizerKeyword["kind"] = "exact_name", extra: Partial<OptimizerKeyword> = {}): OptimizerKeyword =>
  ({ term, kind, isAmbiguous: false, contextTerms: [], ...extra });

const FOCUSFLOW: OptimizerKeyword[] = [
  kw("FocusFlow"), kw("Focus Flow", "misspelling"), kw("focusflow.app", "domain"), kw("FocusFlow App", "custom"),
  kw("FocusFlow review", "custom"), kw("FocusFlow bugs", "custom"), kw("FocusFlow pricing", "custom"),
  kw("FocusFlow alternatives", "custom"),
];

// ------------------------------------------------------------------ optimizer

test("OR-capable platform: brand aliases become ONE query; phrases containing the brand are covered", () => {
  const plan = planQueries(FOCUSFLOW, CAPS.redditComments, null);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0]!.expression, 'FocusFlow OR "focusflow.app" OR "Focus Flow"');
  assert.deepEqual(plan.skipped.map((s) => [s.term, s.reason]).sort(), [
    ["FocusFlow App", "covered"], ["FocusFlow alternatives", "covered"], ["FocusFlow bugs", "covered"],
    ["FocusFlow pricing", "covered"], ["FocusFlow review", "covered"],
  ]);
});

test("domains and handles are searched in their own right, not treated as covered by the name", () => {
  const plan = planQueries([kw("Excalidraw"), kw("excalidraw.com", "custom"), kw("@excalidraw", "custom")], CAPS.blueskyPosts, 5);
  assert.deepEqual(plan.groups.map((g) => g.expression), ["Excalidraw", '"@excalidraw"', '"excalidraw.com"']);
  assert.equal(plan.skipped.length, 0);
});

test("paid platform without OR: one query per keyword, capped by the plan, the rest reported", () => {
  const one = planQueries(FOCUSFLOW, CAPS.tiktokVideos, 1);
  assert.deepEqual(one.groups.map((g) => g.expression), ["FocusFlow"]);
  const capped = one.skipped.find((s) => s.term === "focusflow.app");
  assert.equal(capped?.reason, "query_cap");
  assert.match(capped!.detail, /plan allows 1 separate search per check/);
  const three = planQueries(FOCUSFLOW, CAPS.tiktokVideos, 3);
  assert.deepEqual(three.groups.map((g) => g.expression), ["FocusFlow", "focusflow.app", "Focus Flow"]);
  // No keyword silently disappears.
  const named = new Set([...three.groups.flatMap((g) => g.terms), ...three.skipped.map((s) => s.term)]);
  for (const k of FOCUSFLOW) assert.ok(named.has(k.term), k.term);
  // Free platforms without OR (no cap) search every distinct keyword.
  const free = planQueries(FOCUSFLOW, CAPS.blueskyPosts, null);
  assert.equal(free.skipped.filter((s) => s.reason === "query_cap").length, 0);
});

test("keywords differing only in case or spacing are one search, and the duplicate is reported", () => {
  const plan = planQueries([kw("FocusFlow"), kw("focusflow", "misspelling"), kw("  FocusFlow ", "custom")], CAPS.redditPosts, null);
  assert.deepEqual(plan.groups.map((g) => g.expression), ["FocusFlow"]);
  assert.deepEqual(plan.skipped.map((s) => [s.term, s.reason]), [["focusflow", "duplicate"], ["FocusFlow", "duplicate"]]);
});

test("category terms are never OR-combined with brand aliases; ambiguous terms need context", () => {
  const keywords = [
    kw("FocusFlow"), kw("pomodoro app", "custom"), kw("deep work timer", "custom"),
    kw("Flow", "abbreviation", { isAmbiguous: true, contextTerms: ["pomodoro", "focus timer"] }),
    kw("FF", "abbreviation", { isAmbiguous: true }),
  ];
  const reddit = planQueries(keywords, CAPS.redditPosts, null);
  assert.deepEqual(reddit.groups.map((g) => [g.role, g.expression]), [
    ["brand", "FocusFlow"],
    ["category", '"deep work timer" OR "pomodoro app"'],
    ["ambiguous", 'Flow (pomodoro OR "focus timer")'],
  ]);
  assert.ok(reddit.skipped.some((s) => s.term === "FF" && s.reason === "ambiguous_unsupported"));
  // Without grouping: searched with its first context word (all words required), not dropped.
  const tiktok = planQueries(keywords, CAPS.tiktokVideos, null);
  assert.ok(tiktok.groups.some((g) => g.role === "ambiguous" && g.expression === "Flow pomodoro"));
  assert.ok(tiktok.skipped.some((s) => s.term === "FF" && s.reason === "ambiguous_unsupported"), "no context words: can't search it safely");
});

test("query length and term limits split groups instead of truncating", () => {
  const many = Array.from({ length: 10 }, (_, i) => kw(`Brandname${i}`, "misspelling"));
  const plan = planQueries(many, { ...CAPS.linkedinPosts, maxTerms: 4 }, null);
  assert.deepEqual(plan.groups.map((g) => g.terms.length), [4, 4, 2]);
  const short = planQueries(many, { ...CAPS.redditPosts, maxQueryLength: 40 }, null);
  assert.ok(short.groups.every((g) => g.expression.length <= 40));
  assert.equal(short.groups.flatMap((g) => g.terms).length, 10);
});

test("shared query registry: fingerprints ignore case/whitespace, not platform, stream or filters", () => {
  const a = queryFingerprint({ platform: "reddit", stream: "comments", expression: 'FocusFlow OR "Focus Flow"' });
  assert.equal(a, queryFingerprint({ platform: "reddit", stream: "comments", expression: '  focusflow   OR "focus flow" ' }));
  assert.notEqual(a, queryFingerprint({ platform: "reddit", stream: "posts", expression: 'FocusFlow OR "Focus Flow"' }));
  assert.notEqual(a, queryFingerprint({ platform: "x", stream: "comments", expression: 'FocusFlow OR "Focus Flow"' }));
  assert.notEqual(a, queryFingerprint({ platform: "reddit", stream: "comments", expression: 'FocusFlow OR "Focus Flow"', language: "de" }));
  assert.notEqual(a, queryFingerprint({ platform: "reddit", stream: "comments", expression: 'FocusFlow OR "Focus Flow"', filters: { product: "p1" } }));
  assert.equal(normalizeExpression('A or B OR "C D"'), 'a or b OR "c d"', "lowercase 'or' is a word, uppercase OR an operator");
});

// Adaptive scheduling (activity ranking, intervals, hysteresis) is tested in monitoring.test.ts.

// ------------------------------------------------------------------ comment expansion

test("expansion picks the most promising discussions, skips small or unchanged ones, capped per run", () => {
  const parent = (id: string, comments: number, ageDays = 0) => ({
    parent: { externalId: id, platformId: id, sourceUrl: `https://x.com/a/status/${id}`, title: "t", commentCount: comments, publishedAt: new Date(NOW.getTime() - ageDays * 86_400_000) },
    relevance: 0.9,
  });
  const history = new Map([
    ["seen-recent", { lastExpandedAt: new Date(NOW.getTime() - 3_600_000), commentCountAtLast: 10 }],
    ["seen-grown", { lastExpandedAt: new Date(NOW.getTime() - 24 * 3_600_000), commentCountAtLast: 20 }],
    ["seen-flat", { lastExpandedAt: new Date(NOW.getTime() - 24 * 3_600_000), commentCountAtLast: 40 }],
  ]);
  const d = selectExpansions(
    [parent("small", 1), parent("big-old", 500, 30), parent("big-new", 200), parent("seen-recent", 80), parent("seen-grown", 40), parent("seen-flat", 42)],
    history, { maxParents: 2, now: NOW },
  );
  assert.deepEqual(d.selected.map((p) => p.externalId), ["big-new", "seen-grown"]);
  const reasons = Object.fromEntries(d.skipped.map((s) => [s.externalId, s.reason]));
  assert.deepEqual(reasons, { small: "few_comments", "seen-recent": "recently_expanded", "seen-flat": "no_new_comments", "big-old": "lower_priority" });
  assert.equal(selectExpansions([parent("a", 10), parent("b", 10)], new Map(), { maxParents: 1, now: NOW }).selected.length, 1);
});

// ------------------------------------------------------------------ official sources

test("Bluesky: post URL, replies, engagement; one query per keyword with since/until", async () => {
  assert.equal(bskyPostUrl("at://did:plc:abc/app.bsky.feed.post/3mxv", "dev.bsky.social"), "https://bsky.app/profile/dev.bsky.social/post/3mxv");
  const reply = normalizeBskyPost({
    uri: "at://did:plc:abc/app.bsky.feed.post/3mxv", author: { did: "did:plc:abc", handle: "dev.bsky.social" },
    record: { text: "FocusFlow crashed again", createdAt: "2026-10-15T10:00:00.000Z", reply: { parent: { uri: "at://did:plc:x/app.bsky.feed.post/1" } } },
    likeCount: 2, replyCount: 1, repostCount: 0, quoteCount: 0,
  })!;
  assert.equal(reply.mentionType, "reply");
  assert.equal(reply.parentExternalId, "at://did:plc:x/app.bsky.feed.post/1");
  assert.equal(reply.engagementScore, 3);

  const calls: SourceRequest[] = [];
  const ctx: SourceContext = {
    async request(req) {
      calls.push(req);
      const page = calls.length;
      // Each page is an hour older; createdAt carries a zone offset (as real posts do).
      const createdAt = `2026-10-15T${String(11 - page).padStart(2, "0")}:00:00+02:00`;
      return new Response(JSON.stringify({ posts: [{ uri: `at://did:plc:abc/app.bsky.feed.post/${page}`, author: { handle: "a" }, record: { text: "FocusFlow", createdAt } }], cursor: page < 5 ? `c${page}` : undefined }));
    },
    async paidRequest() { throw new Error("free source"); },
    async cooldown() {},
    now: () => NOW,
  };
  const res = await bluesky.searchMentions({ terms: ["FocusFlow"], query: '"Focus Flow"', window: { since: new Date("2026-10-14T00:00:00Z"), until: NOW }, maxPages: 2 }, ctx);
  const u = new URL(calls[0]!.url);
  assert.equal(u.hostname, "api.bsky.app");
  assert.equal(u.searchParams.get("q"), '"Focus Flow"');
  assert.equal(u.searchParams.get("sort"), "latest");
  assert.equal(u.searchParams.get("since"), "2026-10-14T00:00:00.000Z");
  // No cursor requests (the public AppView refuses them): the next page moves `until` to the oldest post (+1 ms).
  assert.equal(new URL(calls[1]!.url).searchParams.get("cursor"), null);
  assert.equal(new URL(calls[1]!.url).searchParams.get("until"), "2026-10-15T08:00:00.001Z");
  assert.equal(res.items.length, 2);
  assert.equal(res.saturated, true, "more pages left = saturated, not complete");
  assert.equal(res.complete, false);

  // A refused later page keeps the earlier results and records the run as incomplete.
  let n = 0;
  const refusing: SourceContext = {
    ...ctx,
    async request() {
      n++;
      if (n > 1) return new Response("<h1>403 Forbidden</h1>", { status: 403 });
      return new Response(JSON.stringify({ posts: [{ uri: "at://did:plc:abc/app.bsky.feed.post/x", author: { handle: "a" }, record: { text: "FocusFlow", createdAt: "2026-10-15T09:00:00Z" } }], cursor: "c" }));
    },
  };
  const kept = await bluesky.searchMentions({ terms: ["FocusFlow"], window: { since: new Date("2026-10-14T00:00:00Z"), until: NOW }, maxPages: 3 }, refusing);
  assert.equal(kept.items.length, 1);
  assert.equal(kept.complete, false);
  assert.match(kept.incompleteReason!, /refused a further page/);
});

test("DEV: keywords become tags; comment trees are flattened with links", () => {
  assert.equal(devTag("Focus Flow"), "focusflow");
  assert.equal(devTag("ab"), null);
  const parent = { externalId: "article:1", platformId: "1", sourceUrl: "https://dev.to/a/x", title: "FocusFlow tips", commentCount: 2, publishedAt: NOW };
  const out = flattenDevComments([
    { id_code: "c1", created_at: "2026-10-15T08:00:00Z", body_html: "<p>FocusFlow is <b>neat</b></p>", user: { username: "u1" },
      children: [{ id_code: "c2", created_at: "2026-10-15T09:00:00Z", body_html: "<p>agreed</p>", user: { username: "u2" } }] },
  ], parent);
  assert.deepEqual(out.map((c) => c.sourceUrl), ["https://dev.to/u1/comment/c1", "https://dev.to/u2/comment/c2"]);
  assert.equal(out[0]!.content, "FocusFlow is neat");
});

test("App Store: app id and storefront from the URL; metadata entries are skipped", () => {
  assert.deepEqual(appStoreIds("https://apps.apple.com/gb/app/focusflow/id1234567890"), { id: "1234567890", country: "gb" });
  assert.equal(appStoreIds("https://apps.apple.com/app/focusflow"), null);
  const listing = "https://apps.apple.com/us/app/id1234567890?see-all=reviews";
  assert.equal(normalizeAppStoreEntry({ id: { label: "1" }, title: { label: "FocusFlow" } }, listing, "FocusFlow"), null);
  const r = normalizeAppStoreEntry({
    id: { label: "14664897645" }, author: { name: { label: "Sam" } }, updated: { label: "2026-10-14T02:28:35-07:00" },
    "im:rating": { label: "1" }, title: { label: "Crashes" }, content: { label: "Crashes on launch" }, "im:voteSum": { label: "0" },
  }, listing, "FocusFlow")!;
  assert.equal(r.publishedAt.toISOString(), "2026-10-14T09:28:35.000Z");
  assert.equal(r.linkTarget, "listing");
  assert.equal(r.directlyAbout?.score, 0.95);
});
