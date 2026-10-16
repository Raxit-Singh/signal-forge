// Automatic Smart Monitoring: activity ranking, refresh intervals, plan limits,
// incomplete coverage, discovery, hysteresis, spikes, saturation, efficiency,
// explanations. Pure functions; no database, no network.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assessActivity, auditDue, decidePlatformInterval, expansionsPerRun, INTERVAL_STEPS, isOverdue, monitoringEfficiency,
  nextRunAt, rankPlatforms, SATURATION_FLOOR, scoreInterval, type ActivityStats, type IntervalInput,
} from "./adaptive.ts";
import { explainInterval, explainRank } from "./explain.ts";

const NOW = new Date("2026-10-16T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

/** A platform monitored completely for 4 weeks with a given weekly volume. */
const stats = (o: Partial<ActivityStats> = {}): ActivityStats => ({
  n24: 0, prev24: 0, n7: 0, n28: 0, authors7: 0, authored7: 0, engHistory: 0, engHigh7: 0, spikeRecent: false,
  completeShare7: 1, coveredShare7: 1, completeSharePrior: 1, firstMonitoredAt: daysAgo(30), completedChecks: 60,
  lastSuccessAt: daysAgo(0.1), saturatedAt: null, failures: 0, auditMissed: 0, ...o,
});
/** Steady activity: `perWeek` mentions every week, spread evenly, each by a distinct author. */
const steady = (perWeek: number, o: Partial<ActivityStats> = {}) => stats({
  n7: perWeek, n28: perWeek * 4, n24: Math.round(perWeek / 7), prev24: Math.round(perWeek / 7),
  authors7: perWeek, authored7: perWeek, engHistory: perWeek * 4, engHigh7: Math.round(perWeek / 4), ...o,
});
const assess = (s: ActivityStats, inherentlyPartial = false) => assessActivity(s, { now: NOW, inherentlyPartial });

const interval = (o: Partial<IntervalInput> & Pick<IntervalInput, "assessment">): ReturnType<typeof decidePlatformInterval> =>
  decidePlatformInterval({ now: NOW, paid: false, planMinMinutes: 60, maxIntervalMinutes: 1440, boost: null, previous: null, ...o });

// ------------------------------------------------------------------ activity score

test("score is 0–100, deterministic, and grows with activity without one platform saturating everything", () => {
  const scores = [0, 1, 5, 25, 90, 180, 850, 5000].map((n) => assess(steady(n)).score);
  for (const s of scores) assert.ok(s >= 0 && s <= 100);
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i]! >= scores[i - 1]!, `monotonic: ${scores.join(",")}`);
  assert.equal(scores[0], 0, "no activity, no score");
  // Log scaling with a cap: 850 vs 5000 a week are both "very busy", not 6× apart.
  assert.ok(scores[7]! - scores[6]! <= 10, `${scores[6]} vs ${scores[7]}`);
  assert.deepEqual(assess(steady(90)), assess(steady(90)), "deterministic");
});

test("growth, acceleration and spikes raise the score; total volume alone doesn't decide", () => {
  const flat = assess(steady(40)).score;
  const rising = assess(steady(40, { n28: 40 + 3 * 15, n24: 15 })).score; // 40 this week vs 15/week before, 15 today
  const spiking = assess(steady(40, { spikeRecent: true })).score;
  assert.ok(rising > flat, `${rising} > ${flat}`);
  assert.ok(spiking > flat, `${spiking} > ${flat}`);
  const a = assess(steady(40, { n28: 40 + 3 * 15 }));
  assert.equal(a.trend, "rising");
  assert.equal(a.growthPct, Math.round(((40 - 15) / 15) * 100));
  assert.equal(assess(steady(10, { n28: 10 + 3 * 30 })).trend, "falling");
});

test("signals that can't be measured are left out, not counted as zero", () => {
  const noAuthors = assess(steady(30, { authors7: 0, authored7: 0 }));
  assert.equal(noAuthors.components.find((c) => c.id === "authors")!.value, null);
  assert.equal(noAuthors.components.find((c) => c.id === "feedback")!.value, null, "no AI feedback classification yet");
  const total = noAuthors.components.reduce((t, c) => t + c.points, 0);
  assert.ok(Math.abs(total - noAuthors.score) <= 1, "points add up to the score");
  // Engagement is only compared with the platform's own history.
  assert.equal(assess(steady(2, { engHistory: 3 })).components.find((c) => c.id === "engagement")!.value, null);
});

test("ranking orders by score; new platforms are unranked rather than last", () => {
  const rows = [
    { platform: "linkedin", n7: 25, assessment: assess(steady(25)) },
    { platform: "reddit", n7: 850, assessment: assess(steady(850)) },
    { platform: "github", n7: 90, assessment: assess(steady(90)) },
    { platform: "bluesky", n7: 0, assessment: assess(stats({ completedChecks: 1, firstMonitoredAt: daysAgo(1), completeShare7: 0.15, coveredShare7: 0.15 })) },
  ];
  const ranks = rankPlatforms(rows);
  assert.deepEqual([...ranks], [["reddit", 1], ["github", 2], ["linkedin", 3]]);
  assert.equal(ranks.has("bluesky"), false);
});

// ------------------------------------------------------------------ intervals

test("score → interval starting rule, always one of 1/2/3/4/6/12/24 h", () => {
  assert.deepEqual([100, 85, 84, 70, 55, 40, 25, 10, 9, 0].map(scoreInterval), [60, 60, 120, 120, 180, 240, 360, 720, 1440, 1440]);
  for (const n of [0, 1, 3, 10, 40, 200, 2000]) {
    for (const plan of [60, 180, 360, 1440]) {
      for (const paid of [false, true]) {
        const d = interval({ assessment: assess(steady(n)), planMinMinutes: plan, paid });
        assert.ok((INTERVAL_STEPS as readonly number[]).includes(d.interval), `${n}/${plan}: ${d.interval}`);
        assert.ok(d.interval >= plan, "plan floor respected");
        assert.ok(d.reasons.length > 0);
      }
    }
  }
});

test("plan entitlements: the actual interval never beats the plan, and the recommendation is kept separately", () => {
  const busy = assess(steady(850, { n24: 200, spikeRecent: true }));
  const d = interval({ assessment: busy, planMinMinutes: 1440, planName: "Free" });
  assert.equal(d.recommended, 60, "activity justifies hourly");
  assert.equal(d.interval, 1440, "Free plan: daily");
  assert.equal(d.planLimited, true);
  assert.ok(d.reasons.some((r) => /Free plan checks each platform at most every 24 h/.test(r)));
  const pro = interval({ assessment: busy, planMinMinutes: 360, planName: "Pro" });
  assert.equal(pro.interval, 360);
  assert.equal(interval({ assessment: busy, planMinMinutes: 60 }).planLimited, false);
});

test("paid quiet platforms are checked a step less often; source minimums apply (YouTube)", () => {
  const quiet = assess(steady(3));
  const free = interval({ assessment: quiet });
  const paid = interval({ assessment: quiet, paid: true });
  assert.ok(paid.interval > free.interval, `${paid.interval} > ${free.interval}`);
  assert.equal(interval({ assessment: assess(steady(850)), sourceMinMinutes: 1440 }).interval, 1440);
});

test("per-platform maximum interval: a quiet platform is still checked", () => {
  const silent = assess(steady(0));
  assert.equal(interval({ assessment: silent }).interval, 1440);
  const capped = interval({ assessment: silent, maxIntervalMinutes: 720 });
  assert.equal(capped.interval, 720);
  assert.ok(capped.reasons.some((r) => /Never checked less often than every 12 h/.test(r)));
});

test("incomplete coverage: low confidence, and quiet results never slow monitoring down", () => {
  const gappy = assess(steady(0, { coveredShare7: 0.3, completeShare7: 0.3 }));
  assert.equal(gappy.confidence, "low");
  const d = interval({ assessment: gappy, previous: { recommended: 240, pendingSince: daysAgo(5) } });
  assert.equal(d.recommended, 240);
  assert.ok(d.reasons.some((r) => /coverage is incomplete/.test(r)));
  // Inherently partial sources (relevance-ranked search) are never "high".
  assert.equal(assess(steady(20), true).confidence, "medium");
  // Explanation doesn't call it quiet.
  const text = explainInterval({ name: "Reddit", rank: 3, assessment: gappy, n7: 0, mostMentions: false, interval: 240, recommended: 240, planLimited: false, boosted: false });
  assert.doesNotMatch(text, /low and stable/);
  assert.match(text, /coverage is incomplete/);
});

test("baseline from incompletely covered weeks isn't used", () => {
  const a = assess(steady(20, { completeSharePrior: 0.2 }));
  assert.equal(a.baselineWeekly, null);
  assert.equal(a.trend, "unknown");
  assert.equal(a.components.find((c) => c.id === "growth")!.value, null);
});

test("new platform discovery: unranked, moderate interval, no slowing down, never fabricated history", () => {
  const fresh = assess(stats({ completedChecks: 1, firstMonitoredAt: daysAgo(0.5), completeShare7: 0.1, coveredShare7: 0.1, completeSharePrior: 0 }));
  assert.equal(fresh.phase, "discovery");
  assert.equal(fresh.trend, "new");
  assert.equal(fresh.baselineWeekly, null);
  assert.deepEqual(fresh.discovery && [fresh.discovery.checks, fresh.discovery.neededChecks], [1, 3]);
  assert.equal(interval({ assessment: fresh }).interval, 240, "free: 4 h while learning (not 24 h for 'no activity')");
  assert.equal(interval({ assessment: fresh, paid: true }).interval, 360, "paid: 6 h while learning");
  const kept = interval({ assessment: fresh, previous: { recommended: 240, pendingSince: daysAgo(3) } });
  assert.equal(kept.recommended, 240);
  // A busy new platform may still go faster.
  const busyNew = assess(steady(850, { completedChecks: 2, firstMonitoredAt: daysAgo(1) }));
  assert.equal(busyNew.phase, "discovery");
  assert.ok(interval({ assessment: busyNew }).interval < 240);
  // Enough checks and a fully covered week (e.g. after a 30-day initial scan) end discovery.
  assert.equal(assess(steady(5, { completedChecks: 3, firstMonitoredAt: daysAgo(1) })).phase, "ranked");
  assert.match(explainRank({ name: "Bluesky", rank: null, assessment: fresh, n7: 0, mostMentions: false, interval: 240, recommended: 240, planLimited: false, boosted: false }), /isn't ranked yet.*1 of 3 checks so far/);
  // Enough checks but an incompletely covered first week: progress is by days, never "9 of 3 checks".
  const partialWeek = assess(steady(5, { completedChecks: 9, firstMonitoredAt: daysAgo(1.2), completeShare7: 0.58 }));
  assert.equal(partialWeek.phase, "discovery");
  assert.ok(interval({ assessment: partialWeek }).reasons.some((r) => /day 2 of 7, or sooner once a full week is completely covered/.test(r)));
});

test("hysteresis: speed up fast, slow down one step only after sustained low activity", () => {
  const quiet = assess(steady(0));
  // First decision with a shorter previous interval starts the timer instead of jumping to 24 h.
  const first = interval({ assessment: quiet, previous: { recommended: 240, pendingSince: null } });
  assert.equal(first.recommended, 240);
  assert.equal(first.pendingSince?.getTime(), NOW.getTime());
  // Still pending after 10 hours…
  const later = decidePlatformInterval({ ...baseInput(quiet), now: new Date(NOW.getTime() + 10 * 3_600_000), previous: { recommended: 240, pendingSince: NOW } });
  assert.equal(later.recommended, 240);
  // …one step (4 h → 6 h, not 24 h) once low for a day.
  const day = decidePlatformInterval({ ...baseInput(quiet), now: new Date(NOW.getTime() + 25 * 3_600_000), previous: { recommended: 240, pendingSince: NOW } });
  assert.equal(day.recommended, 360);
  assert.equal(day.pendingSince, null, "the next step needs another sustained period");
  // Speeding up needs no wait (up to two steps per decision).
  const busy = interval({ assessment: assess(steady(400)), previous: { recommended: 720, pendingSince: null } });
  assert.equal(busy.recommended, 240, "12 h → 4 h in one decision");
});

test("hysteresis dead band: a score at a boundary doesn't flip the interval", () => {
  // Find a score just under a band boundary (55 → 3 h vs 4 h).
  const a = assess(steady(40));
  const nearBoundary = { ...a, score: 53 };
  const d = interval({ assessment: nearBoundary, previous: { recommended: 180, pendingSince: daysAgo(3) } });
  assert.equal(d.recommended, 180, "53 is within 5 points of 55: stays at 3 h");
  const clearlyLower = { ...a, score: 45 };
  assert.equal(interval({ assessment: clearlyLower, previous: { recommended: 180, pendingSince: daysAgo(3) } }).recommended, 240);
});

test("spike acceleration: a recent spike caps the interval at 2 h immediately", () => {
  const quietWithSpike = assess(steady(2, { spikeRecent: true }));
  const d = interval({ assessment: quietWithSpike, previous: { recommended: 1440, pendingSince: null } });
  assert.equal(d.recommended, 120, "no two-step limit for spikes");
  assert.ok(d.reasons.some((r) => /spike/.test(r)));
});

test("pagination saturation: counts are lower bounds, score floor and a sooner check", () => {
  const sat = assess(steady(2, { saturatedAt: daysAgo(1) }));
  assert.equal(sat.score, SATURATION_FLOOR);
  assert.equal(sat.saturatedRecently, true);
  assert.equal(sat.confidence, "medium");
  const d = interval({ assessment: sat, previous: { recommended: 720, pendingSince: null } });
  assert.equal(d.recommended, 120, "3 h band, one step sooner, applied at once");
  assert.equal(assess(steady(2, { saturatedAt: daysAgo(4) })).saturatedRecently, false);
});

test("audit misses speed checks up; failures retry sooner; overdue detection", () => {
  const missed = interval({ assessment: assess(steady(20, { auditMissed: 2 })) });
  const clean = interval({ assessment: assess(steady(20)) });
  assert.ok(missed.interval < clean.interval);
  assert.equal(nextRunAt(NOW, 720, 0).getTime() - NOW.getTime(), 720 * 60_000);
  assert.equal(nextRunAt(NOW, 720, 1).getTime() - NOW.getTime(), 30 * 60_000);
  assert.equal(nextRunAt(NOW, 720, 3).getTime() - NOW.getTime(), 120 * 60_000);
  assert.equal(isOverdue(daysAgo(1), 360, NOW), true, "nothing for 24 h on a 6 h interval");
  assert.equal(isOverdue(daysAgo(0.4), 360, NOW), false);
  assert.equal(auditDue(null, true, null, NOW), true);
  assert.equal(auditDue(daysAgo(8), true, 10, NOW), false, "quiet paid platforms are audited every 14 days");
  assert.equal(auditDue(daysAgo(8), true, 60, NOW), true);
  assert.deepEqual([null, 20, 50, 75, 95].map(expansionsPerRun), [1, 1, 2, 3, 4]);
});

test("Launch Boost: down to the boost minimum, at most 3 h, ends automatically", () => {
  const quiet = assess(steady(1));
  const boost = { minMinutes: 60, endsAt: new Date(NOW.getTime() + 3 * DAY) };
  assert.equal(interval({ assessment: quiet, planMinMinutes: 360 }).interval, 720);
  const b = interval({ assessment: quiet, planMinMinutes: 360, boost });
  assert.equal(b.interval, 180);
  assert.match(b.reasons[0]!, /Launch Boost active/);
  assert.equal(interval({ assessment: assess(steady(850)), planMinMinutes: 360, boost }).interval, 60);
  assert.equal(interval({ assessment: quiet, planMinMinutes: 360, boost: { minMinutes: 360, endsAt: boost.endsAt } }).interval, 360, "Free boost minimum 6 h");
  assert.equal(interval({ assessment: quiet, planMinMinutes: 360, boost: { ...boost, endsAt: daysAgo(0.01) } }).interval, 720, "expired");
});

// ------------------------------------------------------------------ efficiency

test("efficiency compares only monitored time, and waits for enough history", () => {
  assert.equal(monitoringEfficiency([]).percentFewer, null);
  assert.equal(monitoringEfficiency([{ observedHours: 5, checks: 2 }]).percentFewer, null, "under 24 h of history");
  const e = monitoringEfficiency([{ observedHours: 168, checks: 14 }, { observedHours: 48, checks: 2 }]);
  assert.deepEqual([e.checks, e.hourlyBaseline, e.avoided, e.percentFewer], [16, 216, 200, 93]);
  // A group that was off (0 h observed) adds nothing to the baseline.
  assert.equal(monitoringEfficiency([{ observedHours: 168, checks: 14 }, { observedHours: 0, checks: 0 }]).hourlyBaseline, 168);
});

// ------------------------------------------------------------------ explanations

test("explanations are templates over real metrics", () => {
  const reddit = assess(steady(850, { n28: 850 + 3 * 600 }));
  const text = explainRank({ name: "Reddit", rank: 1, assessment: reddit, n7: 850, mostMentions: true, interval: 60, recommended: 60, planLimited: false, boosted: false });
  assert.equal(text, "Reddit ranks #1 because it generated the most relevant mentions this week (850) and activity increased 42% compared with its previous baseline.");
  const linkedin = assess(steady(1));
  assert.equal(
    explainInterval({ name: "LinkedIn", rank: 5, assessment: linkedin, n7: 1, mostMentions: false, interval: 720, recommended: 720, planLimited: false, boosted: false }),
    "LinkedIn is checked every 12 h because recent activity is low and stable.",
  );
  assert.match(
    explainInterval({ name: "X", rank: 2, assessment: reddit, n7: 850, mostMentions: false, interval: 1440, recommended: 60, planLimited: true, planName: "Free", boosted: false }),
    /^X is checked every 24 h, the most often your Free plan allows \(activity is high: on its own that would justify every 1 h\)\.$/,
  );
});

// Keyword plans, rotation and coverage are tested in keyword-coverage.test.ts.

function baseInput(assessment: ReturnType<typeof assess>): IntervalInput {
  return { now: NOW, assessment, paid: false, planMinMinutes: 60, maxIntervalMinutes: 1440, boost: null, previous: null };
}
