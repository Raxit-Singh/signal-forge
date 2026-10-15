// Smart Adaptive Monitoring (pure, deterministic — no LLM).
//
// Decides the refresh interval for one Product + Platform + Query group from
// observed activity, cost and coverage signals. Safety rules come first:
//   * intervals are always one of 1/2/3/4/6/12/24 h and never above 24 h
//   * the plan's minimum interval is respected (a Launch Boost may go lower,
//     down to the plan's boost minimum)
//   * an interval may lengthen by at most ONE step per decision, and never
//     while coverage confidence is low — quiet results from rare checks can't
//     snowball into ever-rarer checks (self-reinforcing gaps)
//   * saturated pages, spikes, audit misses and failures shorten the interval
// Every decision returns human-readable reasons.

import type { MonitoringMode } from "./query-optimizer.ts";

export const INTERVAL_STEPS = [60, 120, 180, 240, 360, 720, 1440] as const;
export const MAX_INTERVAL = 1440;

export const MODE_BOUNDS: Record<MonitoringMode, { min: number; max: number }> = {
  priority: { min: 60, max: 360 },
  balanced: { min: 120, max: 720 },
  eco: { min: 240, max: 1440 },
};

export type Confidence = "high" | "medium" | "low";

export interface ScheduleInput {
  now: Date;
  mode: MonitoringMode;
  paid: boolean;
  /** 0..1; lower-importance platforms are checked less often when quiet. */
  platformImportance: number;
  /** Plan's minimum interval (minutes). */
  planMinMinutes: number;
  /** Hard floor imposed by the source itself (e.g. YouTube's shared search quota). */
  sourceMinMinutes?: number;
  /** Source can't promise completeness even when nothing is capped (relevance-ranked search). */
  inherentlyPartial?: boolean;
  boost?: { mode: "balanced" | "priority"; minMinutes: number; endsAt: Date } | null;
  /** Relevant mentions for this product on this platform. */
  activity: { last24h: number; prev24h: number; dailyAvg7d: number; dailyAvg28d: number };
  spikeActive: boolean;
  /** null when sentiment classification doesn't exist yet. */
  negativeSpike: boolean | null;
  lastRun: { complete: boolean; saturated: boolean } | null;
  consecutiveFailures: number;
  /** Items a completeness audit found that regular checks had missed. */
  auditMissed: number;
  previousIntervalMinutes: number | null;
}

export interface ScheduleDecision {
  intervalMinutes: number;
  /** When the next check should run (failure recovery may pull it earlier than the interval). */
  nextRunAt: Date;
  confidence: Confidence;
  reasons: string[];
}

function snapUp(minutes: number): number {
  return INTERVAL_STEPS.find((s) => s >= minutes) ?? MAX_INTERVAL;
}

function step(minutes: number, delta: number): number {
  const i = INTERVAL_STEPS.indexOf(snapUp(minutes) as (typeof INTERVAL_STEPS)[number]);
  return INTERVAL_STEPS[Math.max(0, Math.min(INTERVAL_STEPS.length - 1, i + delta))]!;
}

/** Interval suggested by activity alone: busier platforms are checked more often. */
export function activityInterval(perDay: number): number {
  if (perDay >= 20) return 60;
  if (perDay >= 8) return 120;
  if (perDay >= 4) return 180;
  if (perDay >= 2) return 240;
  if (perDay >= 0.7) return 360;
  if (perDay >= 0.2) return 720;
  return 1440;
}

export function coverageConfidence(i: Pick<ScheduleInput, "lastRun" | "consecutiveFailures" | "auditMissed" | "inherentlyPartial">): Confidence {
  if (!i.lastRun || i.consecutiveFailures >= 2 || i.auditMissed >= 3) return "low";
  if (i.inherentlyPartial || i.consecutiveFailures === 1 || i.lastRun.saturated || !i.lastRun.complete || i.auditMissed > 0) return "medium";
  return "high";
}

export function decideInterval(i: ScheduleInput): ScheduleDecision {
  const reasons: string[] = [];
  const boosted = Boolean(i.boost && i.boost.endsAt > i.now);
  const mode: MonitoringMode = boosted ? i.boost!.mode : i.mode;
  const bounds = MODE_BOUNDS[mode];
  const confidence = coverageConfidence(i);

  const perDay = Math.max(i.activity.last24h, i.activity.dailyAvg7d);
  let interval = activityInterval(perDay);
  reasons.push(perDay > 0
    ? `About ${perDay < 1 ? perDay.toFixed(1) : Math.round(perDay)} relevant mention(s) a day recently`
    : "No recent relevant mentions");

  const rising = i.activity.last24h >= 3 && i.activity.last24h >= 2 * Math.max(i.activity.dailyAvg28d, i.activity.prev24h, 0.5);
  if (rising) {
    interval = step(interval, -1);
    reasons.push("Mentions are rising compared with the usual level");
  }
  if (i.spikeActive) {
    interval = Math.min(interval, 120);
    reasons.push("A spike was detected recently");
  }
  if (i.negativeSpike) {
    interval = Math.min(interval, 120);
    reasons.push("Negative feedback is spiking");
  }
  if (i.lastRun?.saturated) {
    interval = step(interval, -1);
    reasons.push("Last check hit its page limit, so results may be arriving faster than we read them");
  }
  if (i.auditMissed > 0) {
    interval = step(interval, -1);
    reasons.push(`A completeness audit found ${i.auditMissed} mention(s) regular checks had missed`);
  }
  if (!rising && !i.spikeActive && i.platformImportance < 0.6) {
    interval = step(interval, +1);
    reasons.push("Lower-priority platform while activity is quiet");
  }
  if (i.paid && mode === "eco" && !i.spikeActive) {
    interval = step(interval, +1);
    reasons.push("Eco mode: fewer paid checks");
  }

  // Mode bounds.
  if (interval < bounds.min) {
    interval = bounds.min;
    reasons.push(`${mode[0]!.toUpperCase()}${mode.slice(1)} mode checks at most every ${bounds.min / 60} h`);
  }
  if (interval > bounds.max) interval = bounds.max;

  // Safety: lengthen by at most one step, and not at all while confidence is low.
  if (i.previousIntervalMinutes !== null && interval > i.previousIntervalMinutes) {
    if (confidence === "low") {
      interval = snapUp(i.previousIntervalMinutes);
      reasons.push("Kept the current interval: coverage confidence is low");
    } else if (interval > step(i.previousIntervalMinutes, +1)) {
      interval = step(i.previousIntervalMinutes, +1);
      reasons.push("Slowing down gradually (one step at a time)");
    }
  }

  // Floors: plan (or boost), then the source's own limit. Always within 1–24 h.
  const floor = boosted ? i.boost!.minMinutes : i.planMinMinutes;
  if (interval < floor) {
    interval = snapUp(floor);
    reasons.push(boosted ? `Launch Boost minimum is ${floor / 60} h` : `Your plan checks at most every ${floor / 60} h`);
  }
  if (i.sourceMinMinutes && interval < i.sourceMinMinutes) {
    interval = snapUp(i.sourceMinMinutes);
    reasons.push(`This source allows a check at most every ${i.sourceMinMinutes / 60} h`);
  }
  interval = Math.min(snapUp(interval), MAX_INTERVAL);
  if (boosted) reasons.unshift(`Launch Boost active until ${i.boost!.endsAt.toISOString().slice(0, 16).replace("T", " ")} UTC`);

  // Failure recovery: retry sooner (the checkpoint didn't advance, so the gap is re-searched).
  let next = i.now.getTime() + interval * 60_000;
  if (i.consecutiveFailures > 0) {
    const backoff = Math.min(interval, 30 * 2 ** (i.consecutiveFailures - 1)) * 60_000;
    next = i.now.getTime() + backoff;
    reasons.push(`Retrying sooner after ${i.consecutiveFailures} failed check(s)`);
  }
  if (i.inherentlyPartial) reasons.push("This source can't guarantee complete results");

  return { intervalMinutes: interval, nextRunAt: new Date(next), confidence, reasons };
}

/** Audits: re-search a wider window periodically to measure what regular checks miss. */
export function auditDue(lastAuditAt: Date | null, mode: MonitoringMode, paid: boolean, now: Date): boolean {
  const days = paid ? (mode === "eco" ? 14 : 7) : 7;
  return !lastAuditAt || now.getTime() - lastAuditAt.getTime() >= days * 86_400_000;
}

/** Plain-language freshness: typical delay before a new mention shows up. */
export function expectedDiscoveryMinutes(intervalMinutes: number, indexingLagMinutes = 15): { typical: number; worst: number } {
  return { typical: Math.round(intervalMinutes / 2 + indexingLagMinutes), worst: intervalMinutes + indexingLagMinutes };
}

/** Efficiency vs. checking every hour, over `hours`. */
export function checksAvoided(actualChecks: number, groups: number, hours: number): { hourly: number; avoided: number; percentFewer: number } {
  const hourly = groups * hours;
  const avoided = Math.max(0, hourly - actualChecks);
  return { hourly, avoided, percentFewer: hourly > 0 ? Math.round((avoided / hourly) * 100) : 0 };
}
