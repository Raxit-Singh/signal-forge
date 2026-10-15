// Query optimizer, shared query registry, adaptive scheduling, Launch Boost,
// comment expansion and the free official connectors (with fixtures).
import { test } from "node:test";
import assert from "node:assert/strict";

import { CAPS } from "./capabilities.ts";
import { NON_OR_QUERY_CAP, normalizeExpression, planQueries, queryFingerprint, type OptimizerKeyword } from "./query-optimizer.ts";
import { activityInterval, auditDue, checksAvoided, decideInterval, INTERVAL_STEPS, type ScheduleInput } from "./adaptive.ts";
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

test("platform without OR: one query per keyword, capped by monitoring mode, the rest reported", () => {
  const eco = planQueries(FOCUSFLOW, CAPS.tiktokVideos, NON_OR_QUERY_CAP.eco);
  assert.deepEqual(eco.groups.map((g) => g.expression), ["FocusFlow"]);
  assert.ok(eco.skipped.some((s) => s.term === "focusflow.app" && s.reason === "query_cap"));
  const priority = planQueries(FOCUSFLOW, CAPS.tiktokVideos, NON_OR_QUERY_CAP.priority);
  assert.deepEqual(priority.groups.map((g) => g.expression), ["FocusFlow", "focusflow.app", "Focus Flow"]);
  // No keyword silently disappears.
  const named = new Set([...priority.groups.flatMap((g) => g.terms), ...priority.skipped.map((s) => s.term)]);
  for (const k of FOCUSFLOW) assert.ok(named.has(k.term), k.term);
});

test("category terms are never OR-combined with brand aliases; ambiguous terms need grouping + context", () => {
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
  const tiktok = planQueries(keywords, CAPS.tiktokVideos, 5);
  assert.ok(tiktok.skipped.some((s) => s.term === "Flow" && s.reason === "ambiguous_unsupported"));
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

// ------------------------------------------------------------------ adaptive engine

const base = (o: Partial<ScheduleInput> = {}): ScheduleInput => ({
  now: NOW, mode: "balanced", paid: true, platformImportance: 1, planMinMinutes: 60,
  activity: { last24h: 0, prev24h: 0, dailyAvg7d: 0, dailyAvg28d: 0 },
  spikeActive: false, negativeSpike: null, lastRun: { complete: true, saturated: false },
  consecutiveFailures: 0, auditMissed: 0, previousIntervalMinutes: 720, boost: null, ...o,
});

test("intervals are always one of 1/2/3/4/6/12/24 h and never above 24 h", () => {
  for (const mode of ["eco", "balanced", "priority"] as const) {
    for (const last24h of [0, 1, 3, 10, 50]) {
      for (const plan of [60, 180, 360, 1440]) {
        const d = decideInterval(base({ mode, planMinMinutes: plan, activity: { last24h, prev24h: 0, dailyAvg7d: last24h, dailyAvg28d: 1 } }));
        assert.ok((INTERVAL_STEPS as readonly number[]).includes(d.intervalMinutes), `${mode}/${last24h}/${plan}: ${d.intervalMinutes}`);
        assert.ok(d.intervalMinutes >= plan, "plan floor respected");
        assert.ok(d.reasons.length > 0);
      }
    }
  }
});

test("busy platforms are checked more often; quiet ones less, but only one step at a time", () => {
  assert.equal(activityInterval(25), 60);
  assert.equal(activityInterval(0), 1440);
  const busy = decideInterval(base({ mode: "priority", activity: { last24h: 30, prev24h: 25, dailyAvg7d: 28, dailyAvg28d: 25 } }));
  assert.equal(busy.intervalMinutes, 60);
  const quiet = decideInterval(base({ mode: "eco", previousIntervalMinutes: 240 }));
  assert.equal(quiet.intervalMinutes, 360, "from 4 h it may only slow to 6 h, not jump to 24 h");
  assert.ok(quiet.reasons.some((r) => /gradually/.test(r)));
});

test("low confidence blocks slowing down (no self-reinforcing gaps)", () => {
  const d = decideInterval(base({ mode: "eco", previousIntervalMinutes: 240, consecutiveFailures: 2 }));
  assert.equal(d.confidence, "low");
  assert.equal(d.intervalMinutes, 240);
});

test("spikes, saturation and audit misses speed monitoring up", () => {
  assert.equal(decideInterval(base({ spikeActive: true, previousIntervalMinutes: 720 })).intervalMinutes, 120);
  const sat = decideInterval(base({ lastRun: { complete: false, saturated: true }, activity: { last24h: 1, prev24h: 1, dailyAvg7d: 1, dailyAvg28d: 1 } }));
  assert.equal(sat.intervalMinutes, 240, "6 h → 4 h after a saturated run");
  const audit = decideInterval(base({ auditMissed: 2, activity: { last24h: 1, prev24h: 1, dailyAvg7d: 1, dailyAvg28d: 1 } }));
  assert.equal(audit.intervalMinutes, 240);
  assert.equal(audit.confidence, "medium");
});

test("failures schedule a quicker recovery run without changing the interval", () => {
  const d = decideInterval(base({ consecutiveFailures: 1 }));
  assert.equal(d.nextRunAt.getTime() - NOW.getTime(), 30 * 60_000);
  const d3 = decideInterval(base({ consecutiveFailures: 3 }));
  assert.equal(d3.nextRunAt.getTime() - NOW.getTime(), 120 * 60_000);
});

test("Launch Boost raises frequency down to the boost minimum, then expires", () => {
  const boost = { mode: "priority" as const, minMinutes: 60, endsAt: new Date(NOW.getTime() + 3 * 86_400_000) };
  const quiet = base({ planMinMinutes: 360, previousIntervalMinutes: 360, activity: { last24h: 25, prev24h: 20, dailyAvg7d: 20, dailyAvg28d: 20 } });
  assert.equal(decideInterval(quiet).intervalMinutes, 360, "without boost: plan floor (6 h)");
  const boosted = decideInterval({ ...quiet, boost });
  assert.equal(boosted.intervalMinutes, 60);
  assert.match(boosted.reasons[0]!, /Launch Boost active/);
  const expired = decideInterval({ ...quiet, boost: { ...boost, endsAt: new Date(NOW.getTime() - 1) } });
  assert.equal(expired.intervalMinutes, 360, "returns to normal automatically");
});

test("eco mode makes fewer paid checks; free sources aren't penalized for cost", () => {
  const act = { last24h: 3, prev24h: 3, dailyAvg7d: 3, dailyAvg28d: 3 };
  const paidEco = decideInterval(base({ mode: "eco", activity: act, previousIntervalMinutes: 360 }));
  const freeEco = decideInterval(base({ mode: "eco", paid: false, activity: act, previousIntervalMinutes: 360 }));
  assert.ok(paidEco.intervalMinutes > freeEco.intervalMinutes);
});

test("source minimums (YouTube) and audits", () => {
  assert.equal(decideInterval(base({ sourceMinMinutes: 1440, spikeActive: true })).intervalMinutes, 1440);
  assert.equal(auditDue(null, "balanced", true, NOW), true);
  assert.equal(auditDue(new Date(NOW.getTime() - 8 * 86_400_000), "eco", true, NOW), false, "eco audits paid sources every 14 days");
  assert.deepEqual(checksAvoided(30, 2, 168), { hourly: 336, avoided: 306, percentFewer: 91 });
});

// ------------------------------------------------------------------ comment expansion

test("expansion picks the most promising discussions, skips small or unchanged ones, capped by mode", () => {
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
    history, { mode: "balanced", now: NOW },
  );
  assert.deepEqual(d.selected.map((p) => p.externalId), ["big-new", "seen-grown"]);
  const reasons = Object.fromEntries(d.skipped.map((s) => [s.externalId, s.reason]));
  assert.deepEqual(reasons, { small: "few_comments", "seen-recent": "recently_expanded", "seen-flat": "no_new_comments", "big-old": "lower_priority" });
  assert.equal(selectExpansions([parent("a", 10), parent("b", 10)], new Map(), { mode: "eco", now: NOW }).selected.length, 1);
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
      return new Response(JSON.stringify({ posts: [{ uri: `at://did:plc:abc/app.bsky.feed.post/${page}`, author: { handle: "a" }, record: { text: "FocusFlow", createdAt: "2026-10-15T09:00:00Z" } }], cursor: page < 5 ? `c${page}` : undefined }));
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
  assert.equal(new URL(calls[1]!.url).searchParams.get("cursor"), "c1");
  assert.equal(res.saturated, true, "more pages left = saturated, not complete");
  assert.equal(res.complete, false);
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
