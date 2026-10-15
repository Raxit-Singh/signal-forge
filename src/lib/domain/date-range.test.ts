import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRange, previousWindow } from "./date-range.ts";

const now = new Date("2026-10-14T09:30:00.000Z");

test("defaults to 30 days, inclusive of today (UTC)", () => {
  const r = parseRange({}, now);
  assert.equal(r.key, "30d");
  assert.equal(r.fromDate, "2026-09-15");
  assert.equal(r.toDate, "2026-10-14");
  assert.equal(r.days, 30);
  assert.equal(r.to.getTime(), now.getTime());
});

test("24h is a rolling window", () => {
  const r = parseRange({ range: "24h" }, now);
  assert.equal(r.to.getTime() - r.from.getTime(), 86_400_000);
});

test("7d starts at UTC midnight six days ago", () => {
  const r = parseRange({ range: "7d" }, now);
  assert.equal(r.from.toISOString(), "2026-10-08T00:00:00.000Z");
});

test("custom range is inclusive and clamps the end to today", () => {
  const r = parseRange({ range: "custom", from: "2026-10-01", to: "2026-12-31" }, now);
  assert.equal(r.custom, true);
  assert.equal(r.toDate, "2026-10-14");
  assert.equal(r.days, 14);
  assert.equal(r.to.getTime(), now.getTime(), "never extends past now");
  const closed = parseRange({ range: "custom", from: "2026-09-01", to: "2026-09-30" }, now);
  assert.equal(closed.to.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(closed.days, 30);
});

test("invalid custom ranges fall back to the default", () => {
  for (const p of [
    { range: "custom", from: "2026-10-10", to: "2026-10-01" },
    { range: "custom", from: "2026-02-30", to: "2026-03-01" },
    { range: "custom", from: "garbage", to: "2026-10-01" },
    { range: "custom", from: "2020-01-01", to: "2026-10-01" },
    { range: "1y" },
  ]) {
    assert.equal(parseRange(p, now).key, "30d", JSON.stringify(p));
  }
});

test("previous window has equal length and abuts the current one", () => {
  const r = parseRange({ range: "7d" }, now);
  const prev = previousWindow(r);
  assert.equal(prev.to.getTime(), r.from.getTime());
  assert.equal(prev.to.getTime() - prev.from.getTime(), r.to.getTime() - r.from.getTime());
});
