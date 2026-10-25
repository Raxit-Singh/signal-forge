import { test } from "node:test";
import assert from "node:assert/strict";

import { change, highlights, lastCompleteWeek, reportCsv, type PeriodNumbers, type ReportData } from "./weekly.ts";

const period = (o: Partial<PeriodNumbers> = {}): PeriodNumbers => ({
  mentions: 0, posts: 0, comments: 0, uniqueAuthors: 0, engagement: 0, coverage: 1, bySource: [],
  sentiment: { classified: 0, unclassified: 0, positive: 0, negative: 0, neutral: 0, mixed: 0, uncertain: 0 },
  feedback: { bugs: 0, features: 0, complaints: 0, praise: 0, questions: 0 }, ...o,
});
const base = (o: Partial<ReportData> = {}): Omit<ReportData, "highlights"> => ({
  version: 1, product: { id: "p", name: "Acme" }, period: { start: "2026-10-05T00:00:00.000Z", end: "2026-10-12T00:00:00.000Z", label: "5–11 Oct 2026" },
  generatedAt: "2026-10-12T06:00:00.000Z", current: period(), previous: period(), daily: [], issues: [], spikes: [], competitors: null, topPosts: [], ...o,
});

test("last complete UTC week: Monday to Monday before now", () => {
  const w = lastCompleteWeek(new Date("2026-10-17T15:00:00Z")); // a Saturday
  assert.equal(w.start.toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-10-12T00:00:00.000Z");
  const monday = lastCompleteWeek(new Date("2026-10-12T00:00:01Z"));
  assert.equal(monday.start.toISOString(), "2026-10-05T00:00:00.000Z");
  const sunday = lastCompleteWeek(new Date("2026-10-18T23:00:00Z"));
  assert.equal(sunday.end.toISOString(), "2026-10-12T00:00:00.000Z");
});

test("change is only stated when both weeks were mostly monitored", () => {
  assert.deepEqual(change(150, 100, { current: 1, previous: 1 }), { pct: 50, note: "+50% vs the week before" });
  assert.equal(change(150, 100, { current: 1, previous: 0.3 }).pct, null);
  assert.equal(change(5, 0, { current: 1, previous: 1 }).note, "none the week before");
});

test("highlights are rules over the numbers: volume, top platform, negativity shift, issues, spikes, coverage", () => {
  const h = highlights(base({
    current: period({ mentions: 120, bySource: [{ source: "reddit", mentions: 90 }, { source: "github", mentions: 30 }], coverage: 0.8,
      sentiment: { classified: 40, unclassified: 0, positive: 10, negative: 20, neutral: 10, mixed: 0, uncertain: 0 } }),
    previous: period({ mentions: 100, sentiment: { classified: 40, unclassified: 0, positive: 20, negative: 8, neutral: 12, mixed: 0, uncertain: 0 } }),
    issues: [{ id: "i", title: "Login freezes", category: "bug_report", priority: "high", postsInPeriod: 5, reporters: 4, isNew: true, trend: "new" }],
    spikes: [{ start: "2026-10-07", platform: null, keyword: null, observed: 40, expected: 10, severity: "major", confidence: "confirmed" }],
  }), (s) => s.toUpperCase());
  assert.equal(h[0], "120 relevant mentions (+20% vs the week before).");
  assert.equal(h[1], "Most mentions came from REDDIT (75%).");
  assert.equal(h[2], "50% of classified mentions were negative, up from 20%.");
  assert.match(h[3]!, /1 high-priority issue had activity, led by “Login freezes”/);
  assert.match(h[4]!, /1 new issue appeared/);
  assert.equal(h.length, 5, "no spike or coverage lines: spikes and coverage aren't shown to customers");
  assert.deepEqual(highlights(base(), (s) => s), ["No relevant mentions were collected this week."]);
});

test("CSV: sections, quoting, and no spreadsheet formulas from post titles", () => {
  const csv = reportCsv({ ...base({ topPosts: [{ title: '=HYPERLINK("x"), "quoted"', url: "https://e.x/1", source: "reddit", publishedAt: "2026-10-06", engagement: 3 }] }), highlights: [] }, (s) => s);
  assert.match(csv, /^Report\r\nproduct,period_start,period_end,generated_at\r\nAcme,/);
  assert.ok(csv.includes(`"'=HYPERLINK(""x""), ""quoted"""`), "formula neutralised and quotes escaped");
  assert.match(csv, /Summary\r\nmetric,this_week,previous_week\r\nrelevant_mentions,0,0/);
});
