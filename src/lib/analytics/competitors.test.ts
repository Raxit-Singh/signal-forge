import { test } from "node:test";
import assert from "node:assert/strict";

import { alignDaily, comparableSources, comparisonWindow, shareOfVoice, summarizeSentiment, type Entity } from "./competitors.ts";

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const entity = (id: string, since: string, sources: string[], isProduct = false): Entity => ({ id, name: id.toUpperCase(), isProduct, trackedSince: day(since), sources });

test("window: clamped to when every entity was tracked; empty when there is no overlap", () => {
  const w = comparisonWindow(day("2026-10-01"), day("2026-10-31"), [entity("p", "2026-09-01", [], true), entity("c", "2026-10-10", [])]);
  assert.equal(w.from.toISOString(), day("2026-10-10").toISOString());
  assert.equal(w.clamped, true);
  assert.equal(w.empty, false);
  const all = comparisonWindow(day("2026-10-01"), day("2026-10-31"), [entity("p", "2026-09-01", [], true)]);
  assert.equal(all.clamped, false);
  assert.equal(all.from.toISOString(), day("2026-10-01").toISOString());
  const none = comparisonWindow(day("2026-10-01"), day("2026-10-05"), [entity("c", "2026-10-20", [])]);
  assert.equal(none.empty, true);
});

test("sources: only those monitored for everyone are compared; the rest say who lacks them", () => {
  const r = comparableSources([entity("p", "2026-01-01", ["hackernews", "reddit", "github"], true), entity("c", "2026-01-01", ["hackernews", "github", "bluesky"])]);
  assert.deepEqual(r.common, ["github", "hackernews"]);
  assert.deepEqual(r.excluded, [{ source: "bluesky", missingFor: ["P"] }, { source: "reddit", missingFor: ["C"] }]);
  assert.deepEqual(comparableSources([]), { common: [], excluded: [] });
});

test("share of voice sums to 1, and is null (not 0 %) when nobody has mentions", () => {
  const r = shareOfVoice([{ id: "p", name: "P", isProduct: true, mentions: 30 }, { id: "c", name: "C", isProduct: false, mentions: 10 }]);
  assert.equal(r[0]!.share, 0.75);
  assert.equal(r[1]!.share, 0.25);
  assert.ok(shareOfVoice([{ id: "p", name: "P", isProduct: true, mentions: 0 }]).every((x) => x.share === null));
});

test("sentiment: net score only with enough classified mentions; coverage is reported", () => {
  const few = summarizeSentiment([{ classified: 5, unclassified: 5, positive: 4, negative: 1, neutral: 0, mixed: 0, uncertain: 0 }]);
  assert.equal(few.enough, false);
  assert.equal(few.net, null);
  assert.equal(few.coverage, 0.5);
  const many = summarizeSentiment([
    { classified: 20, unclassified: 0, positive: 10, negative: 5, neutral: 5, mixed: 0, uncertain: 0 },
    { classified: 20, unclassified: 10, positive: 2, negative: 13, neutral: 5, mixed: 0, uncertain: 0 },
  ]);
  assert.equal(many.classified, 40);
  assert.equal(many.net, (12 - 18) / 40);
  assert.equal(many.coverage, 40 / 50);
});

test("daily alignment: one row per day, zeros where an entity had nothing", () => {
  const rows = alignDaily(day("2026-10-01"), day("2026-10-04"), [
    { id: "p", days: [{ day: "2026-10-01", mentions: 3 }, { day: "2026-10-03", mentions: 1 }] },
    { id: "c", days: [{ day: "2026-10-02", mentions: 2 }] },
  ], (d) => d.toISOString().slice(0, 10));
  assert.deepEqual(rows, [
    { day: "2026-10-01", p: 3, c: 0 },
    { day: "2026-10-02", p: 0, c: 2 },
    { day: "2026-10-03", p: 1, c: 0 },
  ]);
});
