import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSeries, detectSpikes, growth, isValidTimeZone, ratioScore, tzOffset, viralityScore, zonedDayStart,
  DAILY_SPIKES, type CoverageRow, type SeriesRow, type ViralityInput,
} from "./buzz.ts";

const B = ["2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z", "2026-10-03T00:00:00.000Z"];
const row = (b: string, source: string, relevant: number, irrelevant = 0): SeriesRow =>
  ({ bucket_start: b, source, relevant, irrelevant, pending: 0, posts: relevant, comments: 0, engagement: 0 });
const cov = (b: string, source: string, covered: number, complete = covered): CoverageRow =>
  ({ bucket_start: b, source, covered, complete, failed: false });

// ------------------------------------------------------------------ series

test("unmonitored buckets are gaps (null), not zeros; partially monitored buckets are flagged", () => {
  const s = buildSeries(B, ["hackernews", "reddit"],
    [row(B[0]!, "hackernews", 3), row(B[0]!, "reddit", 2, 1)],
    [cov(B[0]!, "hackernews", 1), cov(B[0]!, "reddit", 1), cov(B[1]!, "hackernews", 1), cov(B[2]!, "hackernews", 0.2)]);
  assert.deepEqual(s.map((p) => [p.relevant, p.coverage]), [[5, "full"], [0, "partial"], [null, "none"]]);
  assert.equal(s[0]!.irrelevant, 1);
  assert.deepEqual(s[1]!.bySource, { hackernews: 0, reddit: null });
  assert.deepEqual(s[1]!.unmeasured, ["reddit"]);
});

test("capped (partial) coverage is charted but excluded from the complete-only counts used for spikes", () => {
  const s = buildSeries(B.slice(0, 2), ["github", "hackernews"],
    [row(B[1]!, "github", 40), row(B[1]!, "hackernews", 2)],
    [cov(B[0]!, "github", 1, 0), cov(B[1]!, "github", 1, 0), cov(B[0]!, "hackernews", 1), cov(B[1]!, "hackernews", 1)]);
  assert.equal(s[1]!.relevant, 42, "charted");
  assert.equal(s[1]!.relevantComplete, 2, "only completely monitored sources");
  assert.equal(s[1]!.bySourceComplete.github, null);
  assert.equal(s[0]!.coverage, "partial");
});

test("a bucket with mentions counts as measured even without a coverage window", () => {
  const s = buildSeries([B[0]!], ["github"], [row(B[0]!, "github", 4)], []);
  assert.equal(s[0]!.relevant, 4);
  assert.equal(s[0]!.coverage, "partial");
});

test("series totals reconcile with the input rows (property check over random data)", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let trial = 0; trial < 50; trial++) {
    const sources = ["a", "b", "c"];
    const rows: SeriesRow[] = [];
    const coverage: CoverageRow[] = [];
    for (const b of B) for (const s of sources) {
      if (rnd() < 0.7) rows.push(row(b, s, Math.floor(rnd() * 20)));
      coverage.push(cov(b, s, rnd() < 0.8 ? 1 : 0));
    }
    const series = buildSeries(B, sources, rows, coverage);
    const fromSeries = series.reduce((a, p) => a + (p.relevant ?? 0), 0);
    // Rows in unmeasured+empty buckets contribute 0 either way, so sums must match exactly.
    assert.equal(fromSeries, rows.reduce((a, r) => a + r.relevant, 0));
  }
});

// ------------------------------------------------------------------ growth

test("growth handles zero denominators and flags unreliable periods", () => {
  assert.deepEqual(growth(0, 0), { current: 0, previous: 0, change: 0, label: "No change", reliable: true });
  const n = growth(5, 0);
  assert.equal(n.change, null);
  assert.match(n.label, /New activity/);
  assert.equal(growth(15, 10).label, "+50%");
  assert.equal(growth(5, 10).label, "-50%");
  assert.equal(growth(12, 10, { current: 1, previous: 0.4 }).reliable, false);
  const unmonitored = growth(174, 0, { current: 1, previous: 0 });
  assert.equal(unmonitored.change, null);
  assert.equal(unmonitored.label, "No earlier data to compare", "an unmonitored past is not growth from zero");
});

// ------------------------------------------------------------------ virality

const quiet: ViralityInput = {
  last24h: 3, prev24h: 3, baselineDaily: 3, baselineDays: 28, authors24h: 3, baselineAuthorsDaily: 3,
  engagementPerMention24h: 5, baselineEngagementPerMention: 5, platforms24h: 1,
};

test("virality: steady activity scores near zero; a broad, accelerating surge scores high", () => {
  assert.equal(viralityScore(quiet).score, 0);
  const surge = viralityScore({ ...quiet, last24h: 60, prev24h: 10, authors24h: 50, engagementPerMention24h: 20, platforms24h: 4 });
  assert.ok(surge.score! >= 70, String(surge.score));
  assert.equal(surge.factors.length, 5);
  assert.ok(surge.factors.every((f) => f.value >= 0 && f.value <= 1 && f.detail));
  assert.match(surge.note, /not whether it is positive/);
});

test("virality does not favour big products: same relative growth scores the same", () => {
  const small = viralityScore({ ...quiet, last24h: 40, prev24h: 10, baselineDaily: 10, authors24h: 40, baselineAuthorsDaily: 10, platforms24h: 2 });
  const big = viralityScore({ ...quiet, last24h: 4000, prev24h: 1000, baselineDaily: 1000, authors24h: 4000, baselineAuthorsDaily: 1000, platforms24h: 2 });
  assert.ok(Math.abs(small.score! - big.score!) <= 12, `${small.score} vs ${big.score}`);
  const steadyBig = viralityScore({ ...quiet, last24h: 5000, prev24h: 5000, baselineDaily: 5000, authors24h: 3000, baselineAuthorsDaily: 3000 });
  assert.equal(steadyBig.score, 0, "lots of mentions at the usual level is not virality");
});

test("virality: 1 → 3 mentions is not viral; too little history gives no score", () => {
  const tiny = viralityScore({ ...quiet, last24h: 3, prev24h: 1, baselineDaily: 1, authors24h: 3, baselineAuthorsDaily: 1 });
  assert.ok(tiny.score! < 20, String(tiny.score));
  assert.equal(viralityScore({ ...quiet, baselineDays: 1, last24h: 2 }).score, null);
  assert.equal(ratioScore(10, 10), 0);
  assert.ok(Math.abs(ratioScore(14, 6) - 1 / 3) < 1e-9, "×2 → 0.33");
});

// ------------------------------------------------------------------ spikes

const days = (values: Array<number | null>) => values.map((v, i) => ({ start: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(), value: v }));

test("spikes: clear jump over a stable baseline is detected with expected level", () => {
  const s = detectSpikes(days([...Array(20).fill(4), 30]), DAILY_SPIKES);
  assert.equal(s.length, 1);
  assert.equal(s[0]!.observed, 30);
  assert.equal(s[0]!.expected, 4);
  assert.equal(s[0]!.severity, "major");
});

test("spikes: low-volume jumps (1 → 3) and noisy-but-normal days don't alert", () => {
  assert.equal(detectSpikes(days([...Array(20).fill(1), 3]), DAILY_SPIKES).length, 0);
  assert.equal(detectSpikes(days([...Array(20).fill(0), 5]), DAILY_SPIKES).length, 0, "below minimum count");
  const noisy = [10, 30, 12, 28, 9, 31, 11, 27, 10, 29, 12, 30, 11, 28, 9, 31, 34];
  assert.equal(detectSpikes(days(noisy), DAILY_SPIKES).length, 0, "historical variance raises the bar");
});

test("spikes: unmonitored days are excluded from the baseline and never flagged", () => {
  assert.equal(detectSpikes(days([...Array(4).fill(2), ...Array(10).fill(null), 40]), DAILY_SPIKES).length, 0, "too little monitored history");
  const s = detectSpikes(days([...Array(10).fill(3), null, null, ...Array(5).fill(3), 25]), DAILY_SPIKES);
  assert.equal(s.length, 1);
  assert.equal(s[0]!.baselinePeriods, 15);
});

// ------------------------------------------------------------------ time zones

test("local day boundaries follow the viewer's time zone, including DST", () => {
  const t = new Date("2026-10-15T03:30:00Z");
  assert.equal(zonedDayStart(t, "UTC").toISOString(), "2026-10-15T00:00:00.000Z");
  assert.equal(zonedDayStart(t, "America/Los_Angeles").toISOString(), "2026-10-14T07:00:00.000Z");
  assert.equal(zonedDayStart(t, "Asia/Kolkata").toISOString(), "2026-10-14T18:30:00.000Z");
  assert.equal(zonedDayStart(t, "Asia/Kolkata", -1).toISOString(), "2026-10-13T18:30:00.000Z");
  // US DST ends 2026-11-01: the day after starts at 08:00Z, not 07:00Z.
  assert.equal(zonedDayStart(new Date("2026-11-02T12:00:00Z"), "America/Los_Angeles").toISOString(), "2026-11-02T08:00:00.000Z");
  assert.equal(tzOffset(Date.parse("2026-07-01T00:00:00Z"), "Europe/London"), 3_600_000);
  assert.equal(isValidTimeZone("Europe/Berlin"), true);
  assert.equal(isValidTimeZone("Mars/Base"), false);
  assert.equal(isValidTimeZone("UTC'; drop table"), false);
});
