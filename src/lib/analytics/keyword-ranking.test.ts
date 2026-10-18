import { test } from "node:test";
import assert from "node:assert/strict";

import { coverageStatus, growthPct, keywordPerformance, platformPerformance, rankByMentions, type PlatformInput } from "./keyword-ranking.ts";

const P = (id: string, extra: Partial<PlatformInput> = {}): PlatformInput => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), status: "monitored", searchable: new Set(["starlink", "spacex"]), previousObserved: true, ...extra,
});

test("each keyword gets its own platform ranking by mention count", () => {
  const out = keywordPerformance({
    keywords: [{ term: "Starlink", kind: "exact_name", paused: false }, { term: "SpaceX", kind: "custom", paused: false }],
    platforms: [P("instagram"), P("x"), P("reddit")],
    current: [
      { keyword: "starlink", platform: "instagram", mentions: 500 }, { keyword: "Starlink", platform: "x", mentions: 200 }, { keyword: "starlink", platform: "reddit", mentions: 100 },
      { keyword: "spacex", platform: "x", mentions: 600 }, { keyword: "spacex", platform: "reddit", mentions: 300 }, { keyword: "spacex", platform: "instagram", mentions: 50 },
    ],
    previous: [],
  });
  const sp = out.find((k) => k.term === "SpaceX")!;
  const st = out.find((k) => k.term === "Starlink")!;
  assert.deepEqual(st.platforms.map((p) => [p.rank, p.id, p.mentions]), [[1, "instagram", 500], [2, "x", 200], [3, "reddit", 100]]);
  assert.deepEqual(sp.platforms.map((p) => [p.rank, p.id, p.mentions]), [[1, "x", 600], [2, "reddit", 300], [3, "instagram", 50]]);
  assert.equal(st.mentions, 800);
  assert.deepEqual(st.best, { id: "instagram", name: "Instagram", mentions: 500 });
  assert.equal(st.platforms[0]!.sharePct, 63);
  // Keywords themselves are ranked by their totals: SpaceX 950 > Starlink 800.
  assert.deepEqual(out.map((k) => [k.rank, k.term]), [[1, "SpaceX"], [2, "Starlink"]]);
});

test("growth is shown but never changes rank; more mentions does", () => {
  const platforms = [P("instagram"), P("reddit")];
  const before = platformPerformance({ platforms, current: { instagram: 500, reddit: 150 }, previous: { instagram: 476, reddit: 107 } });
  assert.deepEqual(before.map((p) => [p.rank, p.id, p.growthPct]), [[1, "instagram", 5], [2, "reddit", 40]]);
  const after = platformPerformance({ platforms, current: { instagram: 500, reddit: 600 }, previous: { instagram: 476, reddit: 107 } });
  assert.deepEqual(after.map((p) => p.id), ["reddit", "instagram"]);
});

test("rankings are relative to each product's own volume (no absolute thresholds)", () => {
  const small = platformPerformance({ platforms: [P("x"), P("reddit")], current: { x: 3, reddit: 27 }, previous: {} });
  const big = platformPerformance({ platforms: [P("x"), P("reddit")], current: { x: 300, reddit: 2700 }, previous: {} });
  assert.deepEqual(small.map((p) => [p.id, p.rank, p.sharePct]), big.map((p) => [p.id, p.rank, p.sharePct]));
});

test("unscanned platforms are not ranked as zero; scanned zero is ranked last among scanned", () => {
  const out = platformPerformance({
    platforms: [P("youtube", { status: "not_scanned" }), P("reddit"), P("bluesky")],
    current: { reddit: 0, bluesky: 4 }, previous: {},
  });
  assert.deepEqual(out.map((p) => [p.id, p.rank, p.mentions]), [["bluesky", 1, 4], ["reddit", 2, 0], ["youtube", null, null]]);
  assert.equal(out[2]!.growthPct, null);
});

test("ties break deterministically by name", () => {
  const a = rankByMentions([{ id: "x", name: "X", mentions: 5 }, { id: "bluesky", name: "Bluesky", mentions: 5 }]);
  const b = rankByMentions([{ id: "bluesky", name: "Bluesky", mentions: 5 }, { id: "x", name: "X", mentions: 5 }]);
  assert.deepEqual(a.map((r) => r.id), ["bluesky", "x"]);
  assert.deepEqual(a, b);
});

test("growth needs an observed, non-empty previous period", () => {
  assert.equal(growthPct(150, 107, true), 40);
  assert.equal(growthPct(150, 0, true), null);
  assert.equal(growthPct(150, 100, false), null);
});

test("quiet and paused keywords stay listed; platforms that can't search a keyword aren't listed for it", () => {
  const out = keywordPerformance({
    keywords: [{ term: "quiet", kind: "custom", paused: false }, { term: "over-limit", kind: "custom", paused: true }],
    platforms: [P("reddit", { searchable: new Set(["quiet"]) }), P("github", { searchable: new Set() })],
    current: [], previous: [],
  });
  const quiet = out.find((k) => k.term === "quiet")!;
  assert.equal(quiet.mentions, 0);
  assert.deepEqual(quiet.platforms.map((p) => p.id), ["reddit"]);
  assert.equal(quiet.best, null);
  const paused = out.find((k) => k.term === "over-limit")!;
  assert.equal(paused.paused, true);
  assert.equal(paused.rank, null);
});

test("keyword totals sum per platform; a mention matching two keywords counts for each keyword", () => {
  // The same 10 Reddit posts mention both keywords: each keyword shows 10.
  const out = keywordPerformance({
    keywords: [{ term: "a", kind: "custom", paused: false }, { term: "b", kind: "custom", paused: false }],
    platforms: [P("reddit", { searchable: new Set(["a", "b"]) })],
    current: [{ keyword: "a", platform: "reddit", mentions: 10 }, { keyword: "b", platform: "reddit", mentions: 10 }], previous: [],
  });
  assert.deepEqual(out.map((k) => k.mentions), [10, 10]);
});

test("coverage status distinguishes not scanned, learning, partial and monitored", () => {
  assert.equal(coverageStatus({ lastScanAt: null, learning: true, partial: false }), "not_scanned");
  assert.equal(coverageStatus({ lastScanAt: "2026-10-18T00:00:00Z", learning: true, partial: false }), "learning");
  assert.equal(coverageStatus({ lastScanAt: "2026-10-18T00:00:00Z", learning: false, partial: true }), "partial");
  assert.equal(coverageStatus({ lastScanAt: "2026-10-18T00:00:00Z", learning: false, partial: false }), "monitored");
});
