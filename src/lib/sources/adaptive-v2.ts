// Product-adaptive monitoring engine V2 (pure, deterministic — no LLM).
//
// Replaces "activity score → fixed interval" with three separate questions,
// answered per product × platform from that product's own arrival-rate
// estimates (arrival.ts):
//
//   ACTIVITY IMPORTANCE  how much of THIS product's discussion happens here?
//                        Smoothed share of its relevant mentions (product-relative:
//                        two products with the same mix rank platforms the same,
//                        whatever their size). Used for ranking and to tilt freshness.
//   COLLECTION URGENCY   how soon must we look again so retrievable results don't
//                        overflow what one check can read? (brand-safe interval,
//                        from the raw-result rate and the per-check capacity), and
//                        how soon for freshness (expected new relevant mentions per
//                        check ≈ BATCH_TARGET, from the relevant rate).
//   COVERAGE UNCERTAINTY how sure are we? The planning rate is the posterior's 90th
//                        percentile, so little data means checking sooner; failed or
//                        partial coverage blocks slow-downs; new platforms learn first.
//
// No absolute "N mentions ⇒ every X hours" table: intervals scale continuously
// with each product's own rates. Plan floors, source limits, Launch Boost and
// the paid budget still apply afterwards, and when they prevent a brand-safe
// interval the risk is reported, not hidden.

import { mean, profileFactor, safeIntervalMinutes, uncertainty, upperRate, type GroupEstimate } from "./arrival.ts";
import { formatInterval, INTERVAL_STEPS, MAX_INTERVAL, SLOW_DOWN_AFTER_MS, snapUp, step, type Confidence } from "./adaptive.ts";

/** Expected new relevant mentions per check we aim for (freshness), before the importance tilt. */
export const BATCH_TARGET = 3;
/** New platforms: at most this interval until enough checks/exposure exist. */
export const LEARNING_INTERVAL = { free: 240, paid: 360 } as const;
export const LEARNING_MIN_OBSERVATIONS = 3;
export const LEARNING_MIN_EXPOSURE_HOURS = 48;
/** Continuation jobs a resumable source may chain to catch up one overflowing window. */
export const CONTINUATIONS_PER_GAP = 5;

export type CollectionRisk = "none" | "watch" | "at_risk" | "unavoidable";

export interface GroupModel {
  id: string;
  estimate: GroupEstimate;
  /** Results one job can retrieve (pages × page size); null = no practical limit. */
  capacity: number | null;
  /** The source can resume an overflowing window later (date ranges / page offsets). */
  resumable: boolean;
  /** Rotation turns (1 = searched every check). */
  turns: number;
}

export interface PlatformModelInput {
  now: Date;
  paid: boolean;
  planName?: string;
  groups: GroupModel[];
  /** Smoothed share of the product's relevant mentions on this platform (0..1), null if unknown. */
  importanceShare: number | null;
  platformsMonitored: number;
  /** Hour-of-day profile (24 multipliers) or null. */
  profile: number[] | null;
  confidence: Confidence;
  spikeRecent: boolean;
  auditMissed: number;
  planMinMinutes: number;
  sourceMinMinutes?: number;
  maxIntervalMinutes: number;
  boost: { minMinutes: number; endsAt: Date } | null;
  previous: { recommended: number; pendingSince: Date | null } | null;
}

export interface GroupSafety {
  id: string;
  /** Longest brand-safe interval for this search (minutes), null = unconstrained. */
  safeMinutes: number | null;
  rateUpperPerHour: number;
}

export interface PlatformModelDecision {
  learning: boolean;
  /** Relevant mentions per day (posterior mean, summed over searches). */
  arrivalPerDay: number;
  /** Planning rate of raw results per hour (90th percentile). */
  rateUpperPerHour: number;
  uncertainty: number;
  freshMinutes: number | null;
  /** Brand-safe bound for searches that run every check (minutes), null = unconstrained. */
  safeMinutes: number | null;
  groups: GroupSafety[];
  recommended: number;
  interval: number;
  planLimited: boolean;
  pendingSince: Date | null;
  risk: CollectionRisk;
  riskDetail: string | null;
  reasons: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Largest ladder step ≤ minutes (the floor step when nothing fits). */
export function snapDown(minutes: number): number {
  const fits = INTERVAL_STEPS.filter((s) => s <= minutes);
  return fits.length ? fits[fits.length - 1]! : INTERVAL_STEPS[0];
}

/** Importance shares with a Dirichlet(1) prior, so a platform with 0 observed mentions isn't "0%". */
export function importanceShares(counts: Record<string, number>): Record<string, number> {
  const keys = Object.keys(counts);
  const total = keys.reduce((t, k) => t + Math.max(0, counts[k]!), 0) + keys.length;
  return Object.fromEntries(keys.map((k) => [k, (Math.max(0, counts[k]!) + 1) / Math.max(1, total)]));
}

/** Ranks by a per-platform number, highest first (mention counts or importance shares — same order), ties by platform id. */
export function rankByImportance(shares: Record<string, number>, eligible: (p: string) => boolean = () => true): Map<string, number> {
  const ordered = Object.keys(shares).filter(eligible).sort((a, b) => shares[b]! - shares[a]! || a.localeCompare(b));
  return new Map(ordered.map((p, i) => [p, i + 1]));
}

export function isLearning(groups: GroupModel[]): boolean {
  if (groups.length === 0) return true;
  const obs = Math.min(...groups.map((g) => g.estimate.observations));
  const exposure = Math.min(...groups.map((g) => g.estimate.exposureHours));
  return obs < LEARNING_MIN_OBSERVATIONS || exposure < LEARNING_MIN_EXPOSURE_HOURS;
}

export function groupSafety(g: GroupModel, profile: number[] | null, now: Date, horizonMinutes: number): GroupSafety {
  const rate = upperRate(g.estimate.raw) * profileFactor(profile, now, horizonMinutes);
  // Never infer overflow risk from the prior alone: a search with no checks yet has no measured rate.
  if (g.estimate.observations === 0) return { id: g.id, safeMinutes: null, rateUpperPerHour: 0 };
  const capacity = g.capacity === null ? null : g.capacity * (g.resumable ? CONTINUATIONS_PER_GAP : 1);
  return { id: g.id, safeMinutes: safeIntervalMinutes(rate, capacity), rateUpperPerHour: round2(rate) };
}

export function decidePlatformIntervalV2(i: PlatformModelInput): PlatformModelDecision {
  const reasons: string[] = [];
  const learning = isLearning(i.groups);
  const horizon = i.previous?.recommended ?? 360;
  const factor = profileFactor(i.profile, i.now, horizon);

  // Relevant arrivals (sum over this platform's searches; rotating ones are still searched, just less often).
  // Rates come from searches that have actually been checked (the prior alone isn't a measurement).
  const seen = i.groups.filter((g) => g.estimate.observations > 0);
  const relMean = seen.reduce((t, g) => t + mean(g.estimate.rel), 0);
  const relUpper = seen.reduce((t, g) => t + upperRate(g.estimate.rel), 0) * factor;
  const rawUpper = seen.reduce((t, g) => t + upperRate(g.estimate.raw), 0) * factor;
  const unc = i.groups.length ? Math.max(...i.groups.map((g) => uncertainty(g.estimate.raw))) : 1;

  // Freshness: about BATCH_TARGET new relevant mentions per check, tilted by importance.
  const fair = 1 / Math.max(1, i.platformsMonitored);
  const tilt = i.importanceShare === null ? 1 : clamp(Math.sqrt(fair / Math.max(1e-6, i.importanceShare)), 0.5, 2);
  const fresh = relUpper > 0 ? Math.round(((BATCH_TARGET * tilt) / relUpper) * 60) : null;

  // Brand safety: searches that run every check bound the platform interval; rotating searches
  // at risk get their own earlier turns (see applySchedules), so they don't slow everything down.
  const groups = i.groups.map((g) => groupSafety(g, i.profile, i.now, horizon));
  const everyCheck = groups.filter((_, k) => i.groups[k]!.turns <= 1).map((g) => g.safeMinutes).filter((m): m is number => m !== null);
  const safe = everyCheck.length ? Math.min(...everyCheck) : null;

  let target: number;
  if (learning) {
    const start = i.paid ? LEARNING_INTERVAL.paid : LEARNING_INTERVAL.free;
    target = Math.min(start, fresh ?? start, safe ?? start);
    const obs = i.groups.length ? Math.min(...i.groups.map((g) => g.estimate.observations)) : 0;
    reasons.push(`New here: learning this product's activity (${obs} of ${LEARNING_MIN_OBSERVATIONS} checks, ${LEARNING_MIN_EXPOSURE_HOURS} h of history needed)`);
  } else {
    target = Math.min(fresh ?? i.maxIntervalMinutes, i.maxIntervalMinutes);
    reasons.push(fresh === null
      ? "No relevant mentions observed yet: checked at the exploration interval so new activity is still found"
      : `About ${round2(relMean * 24)} relevant mentions a day here (planning for up to ${round2(relUpper * 24)}): checked so each check finds about ${Math.round(BATCH_TARGET * tilt)} new ones`);
    if (fresh !== null && fresh > i.maxIntervalMinutes) reasons.push(`Quiet platform: still checked at least every ${formatInterval(snapUp(i.maxIntervalMinutes))} (exploration)`);
  }
  if (safe !== null && safe < target) {
    target = safe;
    reasons.push(`Busy search: checked within ${formatInterval(Math.max(60, snapDown(safe)))} so results don't overflow what one check can read`);
  }
  if (i.spikeRecent && target > 120) {
    target = 120;
    reasons.push("A spike was detected in the last 3 days");
  }
  let wanted = snapDown(Math.max(INTERVAL_STEPS[0], target));
  if (i.auditMissed > 0) {
    wanted = step(wanted, -1);
    reasons.push(`A completeness audit found ${i.auditMissed} mention(s) regular checks had missed`);
  }

  // Stability: speed up at once when risk rises; slow down one step at a time, only after the
  // lower rate has persisted, never while learning or while coverage is uncertain.
  let recommended = wanted;
  let pendingSince: Date | null = null;
  const prev = i.previous?.recommended ?? null;
  if (prev !== null && wanted > prev) {
    const relaxed = wanted < prev * 1.25; // dead band: tiny drifts don't move the interval
    if (learning || i.confidence === "low" || relaxed) {
      recommended = prev;
      reasons.push(learning ? "Kept the current interval while it's still learning"
        : i.confidence === "low" ? "Kept the current interval: coverage is incomplete, so lower activity can't be confirmed"
        : "Activity changed only slightly, so the interval stays the same");
    } else {
      const since = i.previous?.pendingSince ?? i.now;
      const wait = Math.max(SLOW_DOWN_AFTER_MS, 2 * prev * 60_000);
      if (i.now.getTime() - since.getTime() >= wait) {
        recommended = step(prev, +1);
        reasons.push(`Activity stayed lower for ${Math.round(wait / 3_600_000)} h, so it slows down one step`);
      } else {
        recommended = prev;
        pendingSince = since;
        reasons.push(`Activity is lower; intervals only lengthen after it stays low for ${Math.round(wait / 3_600_000)} h`);
      }
    }
  } else if (prev !== null && wanted < prev) {
    const urgent = (safe !== null && safe < prev) || i.spikeRecent;
    recommended = urgent ? wanted : Math.max(wanted, step(prev, -2));
    reasons.push(urgent ? "Overflow risk or spike: checked sooner right away" : "Activity increased, so it's checked more often");
  }

  // Plan, Launch Boost and source limits.
  let interval = recommended;
  let planLimited = false;
  const boosted = Boolean(i.boost && i.boost.endsAt > i.now);
  let floor = i.planMinMinutes;
  if (boosted) {
    interval = Math.min(interval, 180);
    floor = i.boost!.minMinutes;
    reasons.unshift(`Launch Boost active until ${i.boost!.endsAt.toISOString().slice(0, 16).replace("T", " ")} UTC`);
  }
  if (interval < floor) {
    interval = snapUp(floor);
    planLimited = !boosted;
    reasons.push(`Your ${i.planName ? `${i.planName} ` : ""}plan checks each platform at most every ${formatInterval(interval)}`);
  }
  if (i.sourceMinMinutes && interval < i.sourceMinMinutes) {
    interval = snapUp(i.sourceMinMinutes);
    reasons.push(`This source allows a check at most every ${formatInterval(interval)}`);
  }
  interval = Math.min(interval, MAX_INTERVAL);

  const { risk, detail } = assessRisk(interval, safe, Math.max(floor, i.sourceMinMinutes ?? 0));
  return {
    learning, arrivalPerDay: round2(relMean * 24), rateUpperPerHour: round2(rawUpper), uncertainty: round2(unc),
    freshMinutes: fresh, safeMinutes: safe, groups, recommended, interval, planLimited, pendingSince, risk, riskDetail: detail, reasons,
  };
}

/** Overflow risk at a given interval vs the brand-safe bound. */
export function assessRisk(interval: number, safe: number | null, floorMinutes: number): { risk: CollectionRisk; detail: string | null } {
  if (safe === null) return { risk: "none", detail: null };
  if (interval <= safe) {
    return interval * 1.5 > safe
      ? { risk: "watch", detail: `Close to the busiest safe interval (${formatInterval(Math.max(60, snapDown(safe)))}); watched closely.` }
      : { risk: "none", detail: null };
  }
  if (floorMinutes >= interval && safe < floorMinutes) {
    return {
      risk: "unavoidable",
      detail: `More results arrive than one check can read even at the fastest allowed interval (${formatInterval(floorMinutes)}); some may be missed and coverage is marked partial.`,
    };
  }
  return { risk: "at_risk", detail: `Checked every ${formatInterval(interval)}, but about every ${formatInterval(Math.max(60, snapDown(safe)))} would be needed to read every result; coverage may be partial.` };
}

/**
 * Paid-budget pacing that never lengthens a platform past its brand-safe bound
 * (costliest rate first, one ladder step at a time). If the budget still doesn't
 * fit, the platforms stay at their safe intervals and `fits` is false: spending
 * limits are enforced at request time (requests beyond them are refused), and the
 * shortfall is shown as a coverage risk instead of being hidden by slower checks.
 */
export function paceForBudgetSafely(
  platforms: Array<{ platform: string; interval: number; costPerCheckUsd: number; safeMinutes: number | null; costAt?: (interval: number) => number }>,
  remainingUsd: number,
  minutesLeft: number,
): { intervals: Map<string, number>; paced: Set<string>; blockedBySafety: Set<string>; projectedUsd: number; fits: boolean } {
  const intervals = new Map(platforms.map((p) => [p.platform, p.interval]));
  const paced = new Set<string>();
  const blockedBySafety = new Set<string>();
  // Longer intervals read longer windows: right-sized page counts (costAt) grow with them.
  const cost = (p: (typeof platforms)[number]) => (p.costAt ? p.costAt(intervals.get(p.platform)!) : p.costPerCheckUsd);
  const projected = () => platforms.reduce((t, p) => t + cost(p) * (minutesLeft / intervals.get(p.platform)!), 0);
  let total = projected();
  while (total > remainingUsd) {
    const candidates = platforms
      .filter((p) => {
        const cur = intervals.get(p.platform)!;
        const next = INTERVAL_STEPS.find((s) => s > cur) ?? MAX_INTERVAL;
        if (cost(p) <= 0 || cur >= MAX_INTERVAL) return false;
        if (p.safeMinutes !== null && next > Math.max(p.safeMinutes, p.interval)) {
          blockedBySafety.add(p.platform);
          return false;
        }
        return true;
      })
      .sort((a, b) => cost(b) / intervals.get(b.platform)! - cost(a) / intervals.get(a.platform)! || a.platform.localeCompare(b.platform));
    const next = candidates[0];
    if (!next) break;
    const cur = intervals.get(next.platform)!;
    intervals.set(next.platform, INTERVAL_STEPS.find((s) => s > cur) ?? MAX_INTERVAL);
    paced.add(next.platform);
    total = projected();
  }
  return { intervals, paced, blockedBySafety, projectedUsd: Math.round(total * 10000) / 10000, fits: total <= remainingUsd };
}
