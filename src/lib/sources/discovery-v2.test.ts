// Discovery Engine V2: arrival-rate estimation, product-relative ranking, brand-safe
// pacing, quiet-platform exploration, stability, page right-sizing, resumable
// collection and backfill planning. Pure functions; no database, no network.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  effectiveExposureHours, emptyEstimate, escalationPages, gammaQuantile, hourProfile, mean, normalQuantile,
  pagesToRequest, profileFactor, safeIntervalMinutes, updateEstimate, upperRate, type GroupEstimate,
} from "./arrival.ts";
import {
  assessRisk, BATCH_TARGET, decidePlatformIntervalV2, importanceShares, paceForBudgetSafely, rankByImportance,
  snapDown, type GroupModel, type PlatformModelInput,
} from "./adaptive-v2.ts";
import { collectionProfile, historySupport, jobCapacity, planningCapacity } from "./collection-profile.ts";
import { decideResume, observedSpanMinutes, oldestPublished } from "./resume.ts";
import { planBackfillTasks, runStatus } from "./backfill-plan.ts";
import { createAdapters } from "./registry.ts";
import { estimateCheckCostV2 } from "./entitlements.ts";
import type { CandidateMention } from "./types.ts";

const H = 3_600_000;
const now = new Date("2026-10-16T12:00:00Z");

/** An estimate as if `days` of hourly checks each saw `perHour` results (`relShare` relevant). */
function learned(perHour: number, days = 14, relShare = 0.5): GroupEstimate {
  let e = emptyEstimate();
  for (let h = days * 24; h > 0; h--) {
    const end = new Date(now.getTime() - (h - 1) * H);
    const n = Math.round(perHour);
    e = updateEstimate(e, { results: n, relevant: Math.round(n * relShare), windowStart: new Date(end.getTime() - H), windowEnd: end, saturated: false, at: end });
  }
  return e;
}

function item(minutesAgo: number, id = String(minutesAgo)): CandidateMention {
  return {
    externalId: id, sourceUrl: `https://x.test/${id}`, publishedAt: new Date(now.getTime() - minutesAgo * 60_000),
    engagement: {}, engagementScore: 0, matchText: "starlink",
  };
}

// ------------------------------------------------------------------ arrival model

test("arrival: conjugate update converges to the observed rate and narrows with data", () => {
  const e = learned(10, 14);
  assert.ok(Math.abs(mean(e.raw) - 10) < 0.5, `mean ${mean(e.raw)}`);
  assert.ok(upperRate(e.raw) > mean(e.raw) && upperRate(e.raw) < 10.5);
  const young = learned(10, 0.25); // 6 hours of data
  assert.ok(upperRate(young.raw) - mean(young.raw) > upperRate(e.raw) - mean(e.raw), "less data → wider planning bound");
});

test("arrival: forgetting follows a change in volume within about a week", () => {
  let e = learned(2, 14);
  for (let h = 1; h <= 7 * 24; h++) {
    const end = new Date(now.getTime() + h * H);
    e = updateEstimate(e, { results: 20, relevant: 10, windowStart: new Date(end.getTime() - H), windowEnd: end, saturated: false, at: end });
  }
  assert.ok(mean(e.raw) > 11, `adapted mean ${mean(e.raw)} (past halfway after one half-life)`);
});

test("arrival: a saturated check counts only the span its results covered (never the whole window)", () => {
  const base = { results: 100, relevant: 50, windowStart: new Date(now.getTime() - 24 * H), windowEnd: now, at: now };
  assert.equal(effectiveExposureHours({ ...base, saturated: false }), 24);
  assert.equal(effectiveExposureHours({ ...base, saturated: true, observedSpanMinutes: 120 }), 2);
  assert.equal(effectiveExposureHours({ ...base, saturated: true }), 12, "unknown span → half the window (conservative)");
});

test("arrival: quantile helpers are sane", () => {
  assert.ok(Math.abs(normalQuantile(0.975) - 1.959964) < 1e-5);
  assert.ok(Math.abs(normalQuantile(0.1) + 1.281552) < 1e-5);
  const q = gammaQuantile({ alpha: 100, beta: 10 }, 0.9);
  assert.ok(q > 10 && q < 11.5, String(q));
});

test("arrival: hour-of-day profile needs enough data and averages ~1", () => {
  assert.equal(hourProfile(new Array(24).fill(1)), null);
  const counts = Array.from({ length: 24 }, (_, h) => (h >= 14 && h < 22 ? 40 : 5));
  const p = hourProfile(counts)!;
  assert.ok(p[15]! > 1.5 && p[3]! < 0.6);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) / 24 - 1) < 0.05);
  assert.ok(profileFactor(p, new Date("2026-10-16T14:00:00Z"), 120) > profileFactor(p, new Date("2026-10-16T02:00:00Z"), 120));
});

// ------------------------------------------------------------------ capacity and pages

test("brand-safe interval: expected arrivals plus 2σ stay under 80% of capacity", () => {
  const t = safeIntervalMinutes(50, 300)!; // 50 results/h, 300 readable per check
  const lt = (50 * t) / 60;
  assert.ok(lt + 2 * Math.sqrt(lt) <= 0.8 * 300 + 1e-6);
  assert.ok(t > 200 && t < 300, String(t));
  assert.equal(safeIntervalMinutes(0, 300), null, "nothing arriving → no limit");
  assert.equal(safeIntervalMinutes(5, null), null, "unlimited capacity → no limit");
});

test("page right-sizing: one page while learning, enough for expected results after, never above the bound", () => {
  const base = { perPage: 20, maxPages: 10, billing: "pages" as const };
  assert.equal(pagesToRequest({ ...base, ratePerHour: 100, windowMinutes: 600, learning: true }), 1);
  assert.equal(pagesToRequest({ ...base, ratePerHour: 1, windowMinutes: 180, learning: false }), 1, "quiet search: one page, not two");
  assert.equal(pagesToRequest({ ...base, ratePerHour: 20, windowMinutes: 180, learning: false }), 4); // 60 + 2√60 ≈ 75.5 → 4 pages
  assert.equal(pagesToRequest({ ...base, ratePerHour: 1000, windowMinutes: 600, learning: false }), 10);
  assert.equal(pagesToRequest({ ...base, billing: "request", ratePerHour: 1, windowMinutes: 60, learning: false }), 10, "per-request sources stop by themselves");
});

test("escalation extrapolates the density of the first call over the unread part", () => {
  // 20 results spanning 60 min; 540 min of window left → ~200 more → 13 pages capped at 10.
  assert.equal(escalationPages({ returned: 20, spanMinutes: 60, remainingMinutes: 540, perPage: 20, maxPages: 10, requested: 1 }), 10);
  assert.equal(escalationPages({ returned: 20, spanMinutes: 60, remainingMinutes: 30, perPage: 20, maxPages: 10, requested: 1 }), 2);
  assert.equal(escalationPages({ returned: 200, spanMinutes: 60, remainingMinutes: 600, perPage: 20, maxPages: 10, requested: 10 }), 0, "already at the bound");
});

test("right-sized cost: a quiet search costs one page per check, a busy one more", () => {
  const prices = { "x.posts": 0.006 };
  const quiet = estimateCheckCostV2("x", [{ stream: "posts", rotation: null, rateUpperPerHour: 0.5, learning: false }], 360, prices);
  const busy = estimateCheckCostV2("x", [{ stream: "posts", rotation: null, rateUpperPerHour: 40, learning: false }], 360, prices);
  assert.equal(Math.round(quiet * 1000), 6);
  assert.ok(busy > quiet * 5);
});

// ------------------------------------------------------------------ product-relative ranking

test("ranking is product-relative: same platform mix → same ranks at 200 or 3,000 mentions", () => {
  const mix = { reddit: 0.5, x: 0.3, linkedin: 0.1, hackernews: 0.075, youtube: 0.025 };
  const small = importanceShares(Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, v * 200])));
  const large = importanceShares(Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, v * 3000])));
  assert.deepEqual([...rankByImportance(small)], [...rankByImportance(large)]);
  assert.equal(rankByImportance(small).get("reddit"), 1);
  assert.ok(small.youtube! > 0, "smoothing: a platform is never 0%");
});

function model(perHour: number, extra: Partial<GroupModel> = {}): GroupModel {
  const p = collectionProfile("bluesky", "posts");
  const cap = planningCapacity(p);
  return { id: "g", estimate: learned(perHour), capacity: cap.capacity, resumable: cap.resumable, turns: 1, ...extra };
}

function input(groups: GroupModel[], extra: Partial<PlatformModelInput> = {}): PlatformModelInput {
  return {
    now, paid: false, groups, importanceShare: 0.3, platformsMonitored: 5, profile: null, confidence: "high",
    spikeRecent: false, auditMissed: 0, planMinMinutes: 60, maxIntervalMinutes: 720, boost: null, previous: null, ...extra,
  };
}

test("intervals scale with each product's own arrival rate (no fixed count → interval table)", () => {
  const small = decidePlatformIntervalV2(input([model(200 / 30 / 24 * 0.5 * 2)])); // ~0.28 results/h
  const large = decidePlatformIntervalV2(input([model(3000 / 30 / 24 * 0.5 * 2)])); // ~4.2 results/h
  assert.ok(large.interval < small.interval, `${large.interval} < ${small.interval}`);
  assert.ok(small.reasons.some((r) => r.includes("relevant mentions a day")));
  // Freshness target: about BATCH_TARGET new relevant mentions per check (tilt 1 at a fair share).
  const fair = decidePlatformIntervalV2(input([model(4)], { importanceShare: 0.2 }));
  assert.ok(fair.freshMinutes! > 0);
  assert.ok(Math.abs((fair.freshMinutes! / 60) * (fair.arrivalPerDay / 24) - BATCH_TARGET) < 1.2);
});

test("importance tilts freshness: a dominant platform is checked sooner than a minor one at the same rate", () => {
  const major = decidePlatformIntervalV2(input([model(1)], { importanceShare: 0.6 }));
  const minor = decidePlatformIntervalV2(input([model(1)], { importanceShare: 0.05 }));
  assert.ok(major.freshMinutes! < minor.freshMinutes!);
});

test("brand-safe pacing: a high-volume search is checked before it can overflow one check", () => {
  // TikTok: 250 results per check (10 pages × 25), no resume. A broad keyword: 120 results/h,
  // few of them relevant — freshness alone would allow long intervals, overflow risk doesn't.
  const p = collectionProfile("tiktok", "videos");
  const g = model(120, { estimate: learned(120, 14, 0.005), capacity: planningCapacity(p).capacity, resumable: false });
  const d = decidePlatformIntervalV2(input([g], { paid: true, importanceShare: 0.01 }));
  assert.ok(d.safeMinutes! < 120, String(d.safeMinutes));
  assert.equal(d.interval, 60);
  assert.ok(d.reasons.some((r) => r.includes("overflow")));
  // At a 6 h plan floor the same search can't be made safe: reported as unavoidable, not hidden.
  const floored = decidePlatformIntervalV2(input([g], { paid: true, planMinMinutes: 360 }));
  assert.equal(floored.risk, "unavoidable");
});

test("budget pacing never lengthens a platform past its brand-safe interval", () => {
  const r = paceForBudgetSafely([
    { platform: "x", interval: 60, costPerCheckUsd: 0.06, safeMinutes: 90 },
    { platform: "tiktok", interval: 60, costPerCheckUsd: 0.006, safeMinutes: null },
  ], 1, 30 * 24 * 60);
  assert.ok(r.intervals.get("x")! <= 90);
  assert.ok(r.blockedBySafety.has("x"));
  assert.equal(r.fits, false, "can't fit without losing mentions → reported, not hidden");
  assert.equal(assessRisk(120, 90, 60).risk, "at_risk");
  assert.equal(assessRisk(60, 80, 60).risk, "watch");
  assert.equal(assessRisk(60, 600, 60).risk, "none");
});

test("quiet platforms keep being explored at the platform ceiling, never stopped", () => {
  const silent = decidePlatformIntervalV2(input([model(0)]));
  assert.equal(silent.interval, 720);
  assert.ok(silent.reasons.some((r) => /exploration/i.test(r)));
});

test("no measured rate, no claimed risk: a search never checked isn't scheduled or flagged from the prior", () => {
  const unseen: GroupModel = { id: "g", estimate: emptyEstimate(), capacity: 100, resumable: false, turns: 1 };
  const d = decidePlatformIntervalV2(input([unseen], { paid: false, sourceMinMinutes: 1440 }));
  assert.equal(d.safeMinutes, null);
  assert.equal(d.risk, "none");
  assert.equal(d.arrivalPerDay, 0);
});

test("new platforms learn first (bounded interval until enough checks and exposure)", () => {
  const fresh: GroupModel = { id: "g", estimate: emptyEstimate(), capacity: 500, resumable: true, turns: 1 };
  const d = decidePlatformIntervalV2(input([fresh], { paid: true }));
  assert.equal(d.learning, true);
  assert.ok(d.interval <= 360);
});

test("stability: speeds up at once on overflow risk, slows down only after a sustained drop, one step at a time", () => {
  const busy = decidePlatformIntervalV2(input([model(0.1)], { previous: { recommended: 720, pendingSince: null } }));
  assert.ok(busy.recommended <= 720);
  const quiet = decidePlatformIntervalV2(input([model(0.05)], { previous: { recommended: 120, pendingSince: null } }));
  assert.equal(quiet.recommended, 120, "first low reading: wait");
  assert.ok(quiet.pendingSince);
  const later = decidePlatformIntervalV2(input([model(0.05)], { previous: { recommended: 120, pendingSince: new Date(now.getTime() - 25 * H) } }));
  assert.equal(later.recommended, 180, "one ladder step");
  const lowConf = decidePlatformIntervalV2(input([model(0.05)], { confidence: "low", previous: { recommended: 120, pendingSince: new Date(now.getTime() - 25 * H) } }));
  assert.equal(lowConf.recommended, 120, "never slows down on incomplete coverage");
  const small = decidePlatformIntervalV2(input([model(0.6)], { previous: { recommended: 360, pendingSince: null } }));
  assert.ok(small.recommended === 360 || small.recommended < 360);
  assert.equal(snapDown(100), 60);
  assert.equal(snapDown(30), 60);
});

// ------------------------------------------------------------------ resumable collection

const win = { since: new Date(now.getTime() - 24 * H), until: now };

test("resume (range): an overflowing window leaves a gap ending at the oldest result read", () => {
  const items = [item(10), item(60), item(300)];
  const r = decideResume({ profile: collectionProfile("bluesky", "posts"), window: win, items, saturated: true, pagesRead: 5, previous: null, platformName: "Bluesky" });
  assert.equal(r.complete, false);
  assert.equal(r.lost, null);
  assert.equal(r.gap!.since, win.since.toISOString());
  assert.equal(new Date(r.gap!.until).getTime(), now.getTime() - 300 * 60_000 + 1000);
  assert.equal(oldestPublished(items)!.getTime(), now.getTime() - 300 * 60_000);
  assert.equal(observedSpanMinutes(items, win), 300);
});

test("resume (range): reaching the window start completes it; repeating results stall and close it", () => {
  const done = decideResume({ profile: collectionProfile("hackernews", "default"), window: win, items: [item(24 * 60 + 5)], saturated: true, pagesRead: 5, previous: null, platformName: "HN" });
  assert.equal(done.complete, true);
  const prev = { since: win.since.toISOString(), until: new Date(now.getTime() - 299 * 60_000).toISOString(), stalls: 1 };
  const stalled = decideResume({ profile: collectionProfile("hackernews", "default"), window: { since: win.since, until: new Date(prev.until) }, items: [item(299)], saturated: true, pagesRead: 5, previous: prev, platformName: "HN" });
  assert.equal(stalled.gap, null);
  assert.ok(stalled.lost?.reason.includes("same results"));
});

test("resume (whole-day filters): an overflowing day keeps its newest part and reports the rest lost", () => {
  const w = { since: new Date("2026-10-14T00:00:00Z"), until: new Date("2026-10-16T12:00:00Z") };
  const items = [item(30), item(200)]; // both on 2026-10-16
  const r = decideResume({ profile: collectionProfile("x", "posts"), window: w, items, saturated: true, pagesRead: 10, previous: null, platformName: "X" });
  assert.equal(r.gap!.until, "2026-10-16T00:00:00.000Z", "continues with earlier days");
  assert.ok(r.lost && r.lost.since.toISOString() === "2026-10-16T00:00:00.000Z");
});

test("resume (pages): continues at the next page offset up to the provider's page limit", () => {
  const p = collectionProfile("reddit", "posts");
  const r1 = decideResume({ profile: p, window: win, items: [item(10)], saturated: true, pagesRead: 3, previous: null, platformName: "Reddit" });
  assert.equal(r1.gap!.page, 4);
  const r2 = decideResume({ profile: p, window: win, items: [item(10)], saturated: true, pagesRead: 3, previous: { ...r1.gap!, page: 10 }, platformName: "Reddit" });
  assert.equal(r2.gap, null);
  assert.ok(r2.lost?.reason.includes("12 pages"));
});

test("resume (none): unreachable results are reported lost; inherently partial sources are never complete", () => {
  const r = decideResume({ profile: collectionProfile("tiktok", "videos"), window: win, items: [item(10), item(100)], saturated: true, pagesRead: 10, previous: null, platformName: "TikTok" });
  assert.equal(r.gap, null);
  assert.equal(r.lost!.until.getTime(), now.getTime() - 100 * 60_000);
  const ig = decideResume({ profile: collectionProfile("instagram", "posts"), window: win, items: [item(10)], saturated: true, pagesRead: 2, previous: null, platformName: "Instagram" });
  assert.ok(ig.lost?.reason.includes("relevance"));
});

// ------------------------------------------------------------------ collection profiles and history

test("collection profiles: provider vs application limits; no fixed 300-post Bluesky cap", () => {
  const bsky = collectionProfile("bluesky", "posts");
  assert.equal(bsky.resume, "range");
  assert.equal(planningCapacity(bsky).resumable, true, "Bluesky windows are continued, not cut at 300");
  assert.equal(jobCapacity(collectionProfile("tiktok", "videos")), 250);
  assert.equal(collectionProfile("unknown", "x").resume, "none");
});

test("history support: sources can't search further back than the provider allows", () => {
  const start = new Date(now.getTime() - 90 * 86_400_000);
  const li = historySupport(collectionProfile("linkedin", "posts"), start, now);
  assert.equal(li.full, false);
  assert.equal(li.supportedSince.getTime(), now.getTime() - 30 * 86_400_000);
  assert.equal(historySupport(collectionProfile("hackernews", "default"), start, now).full, true);
  assert.equal(historySupport(collectionProfile("reddit", "comments"), start, now).full, false, "no date filter: newest only");
});

test("backfill planning: one task per search, depth-limited, paid tasks wait while paid sources are off", () => {
  const adapters = createAdapters({ apiDirectKey: "test-key" });
  const start = new Date(now.getTime() - 90 * 86_400_000);
  const tasks = planBackfillTasks([
    { id: "q1", provider: "hackernews", stream: "default" },
    { id: "q2", provider: "linkedin", stream: "posts" },
    { id: "q3", provider: "youtube", stream: "default" },
    { id: "q4", provider: "nope", stream: "x" },
  ], { start, end: now }, adapters, { now, paidEnabled: false });
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0]!.status, "queued");
  assert.equal(tasks[0]!.cursor!.since, start.toISOString());
  assert.equal(tasks[1]!.status, "paused");
  assert.equal(tasks[1]!.cursor!.since, new Date(now.getTime() - 30 * 86_400_000).toISOString());
  assert.equal(tasks[2]!.status, "unavailable", "YouTube without a key");
  assert.equal(runStatus([{ status: "completed" }, { status: "partial" }]), "partial");
  assert.equal(runStatus([{ status: "completed" }, { status: "searching" }]), "searching");
  assert.equal(runStatus([{ status: "completed" }, { status: "paused" }]), "paused");
  assert.equal(runStatus([{ status: "completed" }]), "completed");
  assert.equal(runStatus([{ status: "unavailable" }]), "unavailable");
});
