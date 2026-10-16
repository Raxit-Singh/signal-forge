// Adaptive spike detection: confirmed / possible / insufficient data, low and high
// volume, seasonality, unmonitored periods, backfill safety. Pure; no database.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DAILY_V2, evaluateSpikes, HOURLY_V2, logGamma, negBinUpperTail, poissonUpperTail, productSpikePoint,
  type SpikeSeriesPoint,
} from "./spikes-v2.ts";

const DAY = 86_400_000;
const start = Date.UTC(2026, 8, 1);
function days(values: Array<number | null>, complete: boolean | boolean[] = true): SpikeSeriesPoint[] {
  return values.map((v, i) => ({
    start: new Date(start + i * DAY).toISOString(), value: v,
    complete: Array.isArray(complete) ? complete[i]! : complete,
  }));
}

test("math: log-gamma and tails", () => {
  assert.ok(Math.abs(logGamma(5) - Math.log(24)) < 1e-10);
  assert.ok(Math.abs(poissonUpperTail(3, 1) - (1 - Math.exp(-1) * (1 + 1 + 0.5))) < 1e-12);
  assert.ok(negBinUpperTail(10, 2, 8) > poissonUpperTail(10, 2), "overdispersion makes big counts less surprising");
  assert.equal(poissonUpperTail(0, 3), 1);
});

test("confirmed spike against the product's own baseline (low volume)", () => {
  const ev = evaluateSpikes(days([...Array(20).fill(1), 9]), DAILY_V2);
  const s = ev.spikes.at(-1)!;
  assert.equal(s.confidence, "confirmed");
  assert.ok(s.ratio > 3 && s.pValue < 1e-4);
  assert.equal(ev.status, "evaluated");
});

test("same relative jump on a high-volume product is also a spike; a few percent above normal is not", () => {
  const big = days([...Array(20).fill(400).map((v, i) => v + (i % 5) * 10), 1200]);
  assert.equal(evaluateSpikes(big, DAILY_V2).spikes.at(-1)?.confidence, "confirmed");
  const drift = days([...Array(20).fill(400).map((v, i) => v + (i % 5) * 10), 470]);
  assert.equal(evaluateSpikes(drift, DAILY_V2).spikes.length, 0, "effect size required, not just a tiny p-value");
});

test("no universal threshold: 1 → 3 is ordinary noise, a flat zero history needs real evidence", () => {
  assert.equal(evaluateSpikes(days([...Array(20).fill(1), 3]), DAILY_V2).spikes.length, 0);
  assert.equal(evaluateSpikes(days([...Array(20).fill(0), 2]), DAILY_V2).spikes.length, 0);
});

test("volatile histories raise the bar (robust spread)", () => {
  const noisy = [2, 15, 3, 18, 1, 20, 4, 16, 2, 19, 3, 17, 2, 21, 1, 18, 3, 20, 2, 16];
  assert.equal(evaluateSpikes(days([...noisy, 24]), DAILY_V2).spikes.length, 0);
});

test("possible, not confirmed: incomplete coverage of the period or a short baseline", () => {
  const partial = evaluateSpikes(days([...Array(20).fill(2), 25], [...Array(20).fill(true), false]), DAILY_V2);
  assert.equal(partial.spikes.at(-1)?.confidence, "possible");
  assert.match(partial.spikes.at(-1)!.note!, /partly monitored/);
  const short = evaluateSpikes(days([2, 3, 2, 2, 30]), DAILY_V2);
  assert.equal(short.spikes.at(-1)?.confidence, "possible");
  assert.match(short.spikes.at(-1)!.note!, /short/);
});

test("insufficient data: too few completely monitored periods", () => {
  const ev = evaluateSpikes(days([2, null, null, 40]), DAILY_V2);
  assert.equal(ev.status, "insufficient_data");
  assert.equal(ev.spikes.length, 0);
  assert.equal(ev.neededPeriods, 3);
});

test("without complete history, unusual activity is still shown — as possible, never confirmed", () => {
  const ev = evaluateSpikes(days([...Array(10).fill(5), 60], [...Array(10).fill(false), false]), DAILY_V2);
  assert.equal(ev.status, "insufficient_data");
  assert.equal(ev.spikes.at(-1)?.confidence, "possible");
  assert.match(ev.spikes.at(-1)!.note!, /partly monitored/);
});

test("unmonitored and partial periods are never treated as zero in the baseline", () => {
  // Zeros would make 6 look extreme; unknown periods (null) and partial ones must be skipped.
  const values = [6, 5, 7, null, null, null, null, 6, 5, 6, 7, 5, 6, 6];
  const complete = values.map((v) => v !== null);
  assert.equal(evaluateSpikes(days([...values, 7], [...complete, true]), DAILY_V2).spikes.length, 0);
  const lowPartial = days([...Array(10).fill(6), 0, 0, 0, 7], [...Array(10).fill(true), false, false, false, true]);
  assert.equal(evaluateSpikes(lowPartial, DAILY_V2).spikes.length, 0, "partially collected days don't drag the baseline down");
});

test("seasonality: a regular weekday peak isn't a spike once enough weeks are known", () => {
  // Mondays (UTC day 1) are busy every week: 4 weeks of history.
  const vals: number[] = [];
  for (let i = 0; i < 28; i++) vals.push(new Date(start + i * DAY).getUTCDay() === 1 ? 30 : 5);
  const nextMondayIdx = [...Array(14).keys()].map((k) => 28 + k).find((k) => new Date(start + k * DAY).getUTCDay() === 1)!;
  const series = [...vals];
  for (let k = 28; k < nextMondayIdx; k++) series.push(new Date(start + k * DAY).getUTCDay() === 1 ? 30 : 5);
  series.push(31);
  const ev = evaluateSpikes(days(series), DAILY_V2, series.length - 1);
  assert.equal(ev.spikes.length, 0);
});

test("backfill-safe: history filled in by publication time doesn't create a 'today' spike", () => {
  // A historical search added 30 days of real history at once (by publication date): today is ordinary.
  const backfilled = days([...Array(30).fill(0).map((_, i) => 8 + (i % 3)), 9]);
  assert.equal(evaluateSpikes(backfilled, DAILY_V2).spikes.length, 0);
});

test("hourly config needs two days of complete hours before confirming", () => {
  const hours = Array.from({ length: 30 }, (_, i) => ({ start: new Date(start + i * 3_600_000).toISOString(), value: 2, complete: true }));
  hours.push({ start: new Date(start + 30 * 3_600_000).toISOString(), value: 40, complete: true });
  const ev = evaluateSpikes(hours, HOURLY_V2);
  assert.equal(ev.spikes.at(-1)?.confidence, "possible", "30 h of baseline < 48 h needed");
});

test("product level: a platform cut short (or not monitored) makes the day's total a lower bound; ranked-search platforms don't", () => {
  const inherent = new Set(["instagram"]);
  const full = productSpikePoint({ start: "2026-09-01T00:00:00.000Z", relevant: 12, bySourceComplete: { hn: 10, instagram: null } }, ["hn", "instagram"], inherent, "x");
  assert.equal(full.complete, true, "Instagram can never be complete, so it doesn't block");
  const capped = productSpikePoint({ start: "2026-09-01T00:00:00.000Z", relevant: 12, bySourceComplete: { hn: null, reddit: 5 } }, ["hn", "reddit"], inherent, "x");
  assert.equal(capped.complete, false);
  const today = productSpikePoint({ start: "x", relevant: 3, bySourceComplete: { hn: 3 } }, ["hn"], inherent, "x");
  assert.equal(today.complete, false, "the period in progress is never complete");
});
