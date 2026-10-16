// Historical search selection and broad-keyword warnings. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_HISTORY_MODE, earliestStart, historyWarnings, parseDay, resolveHistoryRange } from "./history.ts";
import { assessKeywordRisk, broadKeywords } from "./keyword-risk.ts";

const now = new Date("2026-10-16T12:00:00Z");

test("history: presets resolve to exact ranges ending now; default is 30 days", () => {
  assert.equal(DEFAULT_HISTORY_MODE, "30d");
  const r = resolveHistoryRange({ mode: "30d", now, planHistoryDays: 365 });
  assert.ok(r.ok);
  assert.equal(r.start.toISOString(), "2026-09-16T12:00:00.000Z");
  assert.equal(r.end.toISOString(), now.toISOString());
  assert.equal(r.days, 30);
});

test("history: since launch needs a launch date, never assumed", () => {
  const missing = resolveHistoryRange({ mode: "launch", now, planHistoryDays: 365 });
  assert.equal(missing.ok, false);
  assert.equal(!missing.ok && missing.field, "launchDate");
  const ok = resolveHistoryRange({ mode: "launch", launchDate: "2026-06-01", now, planHistoryDays: 365 });
  assert.ok(ok.ok && ok.start.toISOString() === "2026-06-01T00:00:00.000Z");
});

test("history: custom dates are validated (format, real date, past, plan window)", () => {
  for (const bad of ["2026-13-01", "2026-02-30", "16/10/2026", ""]) {
    const r = resolveHistoryRange({ mode: "custom", customStart: bad, now, planHistoryDays: 365 });
    assert.equal(r.ok, false, bad);
  }
  const future = resolveHistoryRange({ mode: "custom", customStart: "2026-10-17", now, planHistoryDays: 365 });
  assert.ok(!future.ok && /past/.test(future.error));
  const tooOld = resolveHistoryRange({ mode: "custom", customStart: "2025-01-01", now, planHistoryDays: 365, planName: "Pro" });
  assert.ok(!tooOld.ok && /Pro plan searches back up to 365 days/.test(tooOld.error));
  assert.equal(parseDay("2026-10-01")!.toISOString(), "2026-10-01T00:00:00.000Z");
});

test("history: presets beyond the plan's window are refused with the limit stated", () => {
  const r = resolveHistoryRange({ mode: "90d", now, planHistoryDays: 30, planName: "Free" });
  assert.ok(!r.ok && /Free plan searches back up to 30 days/.test(r.error));
  assert.equal(earliestStart(now, 30).toISOString(), "2026-09-17T00:00:00.000Z");
  assert.equal(resolveHistoryRange({ mode: "bogus", now, planHistoryDays: 30 }).ok, false);
});

test("warnings: measured rate → an estimate; broad keywords → general risk; never an invented number", () => {
  const measured = historyWarnings({ days: 365, broadKeywords: [], measured: { perDay: 60, overDays: 7 }, allowance: 15000, allowanceRemaining: 14000, planName: "Pro" });
  assert.equal(measured[0]!.level, "warning");
  assert.match(measured[0]!.message, /21,900/);
  assert.match(measured[0]!.message, /measured over the last 7 days/);
  const broad = historyWarnings({ days: 90, broadKeywords: ["Starlink"], measured: null, allowance: 15000, allowanceRemaining: 15000, planName: "Pro" });
  assert.match(broad[0]!.message, /may produce more than 15,000 mentions/);
  assert.match(broad[0]!.message, /30 days/);
  assert.doesNotMatch(broad[0]!.message, /about \d/);
  const calm = historyWarnings({ days: 7, broadKeywords: [], measured: null, allowance: 15000, allowanceRemaining: 15000, planName: "Pro" });
  assert.equal(calm.length, 0);
});

test("broad keywords are flagged with reasons, never rejected or rewritten", () => {
  for (const t of ["Apple", "AI", "Cursor", "Notion", "SpaceX", "Elon Musk"]) assert.ok(assessKeywordRisk(t), t);
  const ai = assessKeywordRisk("AI")!;
  assert.ok(ai.reasons.includes("short") && ai.reasons.includes("high_volume"));
  assert.equal(assessKeywordRisk("FocusFlow"), null);
  const cursor = assessKeywordRisk("Cursor", { domain: "cursor.com", category: "AI code editor" })!;
  assert.match(cursor.suggestion!, /cursor\.com/);
  assert.equal(assessKeywordRisk("Cursor", { contextTerms: ["editor"] })!.suggestion, null, "already has context");
  assert.deepEqual(broadKeywords([{ term: "Starlink" }, { term: "Excalidraw" }]).map((r) => r.term), ["Starlink"]);
});
