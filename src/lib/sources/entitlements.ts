// Plan entitlements applied to monitoring (pure; no database, no network).
//
//   * Keyword allowance: active keywords per workspace (Free 1, Pro 10, Scale 40),
//     shared across its active products in creation order. A downgraded workspace
//     keeps its keywords; the ones beyond the allowance are paused (shown, not
//     searched) — never silently dropped.
//   * Keyword refresh target (Free 7 days, Pro 24 h, Scale 6 h): a TARGET. A
//     platform's interval is shortened so its slowest keyword (interval × rotation
//     turns) meets it, but never below the plan floor or a source's own minimum.
//   * Paid-source pacing: if the projected paid spend at those intervals would use
//     up the workspace's monthly paid allowance before the month ends, paid
//     platforms are checked less often (costliest first) until it fits.
// Whatever can't be met is reported as a conflict with the real interval.

import { formatInterval, INTERVAL_STEPS, MAX_INTERVAL } from "./adaptive.ts";
import { STREAM_ENDPOINTS } from "./apidirect/endpoints.ts";
import { expectedResults, pagesToRequest } from "./arrival.ts";
import { collectionProfile } from "./collection-profile.ts";
import { rotationTurns, type Rotation } from "./keyword-plan.ts";
import { KEYWORD_PRIORITY, type OptimizerKeyword } from "./query-optimizer.ts";

// ---------------------------------------------------------------------------
// Keyword allowance
// ---------------------------------------------------------------------------

export interface ProductKeywordCount {
  id: string;
  createdAt: string;
  activeKeywords: number;
}

/** Keywords this product may monitor: the workspace allowance minus earlier products' active keywords. */
export function productKeywordAllowance(productId: string, products: ProductKeywordCount[], maxKeywords: number): number {
  const ordered = [...products].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  let used = 0;
  for (const p of ordered) {
    if (p.id === productId) return Math.max(0, maxKeywords - used);
    used += p.activeKeywords;
  }
  return Math.max(0, maxKeywords - used);
}

/** Splits keywords into monitored (highest priority first, up to the allowance) and paused. */
export function applyKeywordAllowance<K extends OptimizerKeyword>(keywords: K[], allowance: number): { active: K[]; paused: K[] } {
  const ordered = keywords
    .map((k, i) => ({ k, i }))
    .sort((a, b) => KEYWORD_PRIORITY[a.k.kind] - KEYWORD_PRIORITY[b.k.kind] || a.i - b.i)
    .map((x) => x.k);
  return { active: ordered.slice(0, Math.max(0, allowance)), paused: ordered.slice(Math.max(0, allowance)) };
}

// ---------------------------------------------------------------------------
// Keyword refresh target
// ---------------------------------------------------------------------------

/** Longest platform interval (on the 1–24 h ladder) at which `turns` rotations still meet the target; null if none does. */
export function targetIntervalCap(targetMinutes: number, turns: number, floorMinutes: number): number | null {
  const fits = INTERVAL_STEPS.filter((s) => s >= floorMinutes && s * turns <= targetMinutes);
  return fits.length ? fits[fits.length - 1]! : null;
}

export interface TargetDecision {
  interval: number;
  /** Effective interval of the slowest keyword on the platform. */
  slowestKeywordMinutes: number;
  shortened: boolean;
  conflict: string | null;
}

/**
 * Applies the plan's keyword refresh target to one platform's interval.
 * `floorMinutes` = max(plan floor, source minimum). Never goes below it.
 */
export function applyKeywordTarget(opts: {
  platformName: string;
  interval: number;
  rotations: Rotation[];
  targetMinutes: number;
  floorMinutes: number;
  planName: string;
  sourceMinMinutes?: number;
}): TargetDecision {
  const turns = Math.max(1, ...opts.rotations.map((r) => rotationTurns(r)));
  const cap = targetIntervalCap(opts.targetMinutes, turns, opts.floorMinutes);
  let interval = opts.interval;
  let shortened = false;
  if (cap !== null && interval > cap) {
    interval = cap;
    shortened = true;
  } else if (cap === null && interval > opts.floorMinutes) {
    // Unreachable even at the floor: get as close as the plan allows (pacing may lengthen paid ones again).
    interval = opts.floorMinutes;
    shortened = true;
  }
  const slowest = interval * turns;
  let conflict: string | null = null;
  if (slowest > opts.targetMinutes) {
    const why = opts.sourceMinMinutes && opts.sourceMinMinutes >= opts.floorMinutes
      ? `${opts.platformName} allows a check at most every ${formatInterval(opts.sourceMinMinutes)}`
      : turns > 1
        ? `keywords take turns (${turns} checks per round) within the plan's searches per check, and the ${opts.planName} plan checks at most every ${formatInterval(opts.floorMinutes)}`
        : `the ${opts.planName} plan checks at most every ${formatInterval(opts.floorMinutes)}`;
    conflict = `Keyword refresh target (${formatInterval(opts.targetMinutes)}) not met on ${opts.platformName}: each keyword is searched every ${formatInterval(slowest)} because ${why}.`;
  }
  return { interval, slowestKeywordMinutes: slowest, shortened, conflict };
}

// ---------------------------------------------------------------------------
// Paid-source pacing
// ---------------------------------------------------------------------------

export interface PaidGroup {
  stream: string;
  rotation: Rotation | null;
}

/** Pages assumed per page-billed search per check (same assumption as the keyword audit). */
export const ASSUMED_PAGES_PER_CHECK = 2;

/** Estimated paid cost of one platform check (internal; never shown to customers). */
export function estimateCheckCostUsd(platform: string, groups: PaidGroup[], prices: Record<string, number>): number {
  let usd = 0;
  for (const g of groups) {
    const ep = STREAM_ENDPOINTS[`${platform}/${g.stream}`];
    if (!ep) continue;
    const price = prices[ep.pricingKey] ?? 0;
    const units = ep.billing === "pages" ? ASSUMED_PAGES_PER_CHECK : 1;
    usd += (price * units) / (g.rotation ? rotationTurns(g.rotation) : 1);
  }
  return usd;
}

export interface PacingInput {
  platform: string;
  interval: number;
  costPerCheckUsd: number;
}

export interface PacingResult {
  intervals: Map<string, number>;
  paced: Set<string>;
  /** Projected spend to month end at the returned intervals. */
  projectedUsd: number;
  fits: boolean;
}

/**
 * Lengthens paid platform intervals (one ladder step at a time, costliest rate
 * first) until projected spend to the end of the month fits the remaining budget.
 */
export function paceForBudget(platforms: PacingInput[], remainingUsd: number, minutesLeft: number): PacingResult {
  const intervals = new Map(platforms.map((p) => [p.platform, p.interval]));
  const paced = new Set<string>();
  const projected = () => platforms.reduce((t, p) => t + p.costPerCheckUsd * (minutesLeft / intervals.get(p.platform)!), 0);
  let total = projected();
  while (total > remainingUsd) {
    const candidates = platforms
      .filter((p) => p.costPerCheckUsd > 0 && intervals.get(p.platform)! < MAX_INTERVAL)
      .sort((a, b) => b.costPerCheckUsd / intervals.get(b.platform)! - a.costPerCheckUsd / intervals.get(a.platform)! || a.platform.localeCompare(b.platform));
    const next = candidates[0];
    if (!next) break;
    const cur = intervals.get(next.platform)!;
    intervals.set(next.platform, INTERVAL_STEPS.find((s) => s > cur) ?? MAX_INTERVAL);
    paced.add(next.platform);
    total = projected();
  }
  return { intervals, paced, projectedUsd: Math.round(total * 10000) / 10000, fits: total <= remainingUsd };
}

// ---------------------------------------------------------------------------
// V2: right-sized paid cost per check
// ---------------------------------------------------------------------------

export interface PaidGroupV2 extends PaidGroup {
  /** Planning rate of results per hour for this search (arrival.ts upperRate), 0 if unknown. */
  rateUpperPerHour: number;
  learning: boolean;
}

/** Window a check searches beyond its interval (search indexes lag; see monitor OVERLAP_MS). */
export const CHECK_OVERLAP_MINUTES = 120;

/**
 * Estimated paid cost of one platform check at a given interval, with pages
 * right-sized from each search's arrival rate (internal; never shown to
 * customers). Per-request endpoints are assumed to stop after the pages the
 * results fill (at least one request).
 */
export function estimateCheckCostV2(platform: string, groups: PaidGroupV2[], intervalMinutes: number, prices: Record<string, number>): number {
  let usd = 0;
  for (const g of groups) {
    const ep = STREAM_ENDPOINTS[`${platform}/${g.stream}`];
    if (!ep) continue;
    const price = prices[ep.pricingKey] ?? 0;
    const turns = g.rotation ? rotationTurns(g.rotation) : 1;
    const p = collectionProfile(platform, g.stream);
    const windowMinutes = intervalMinutes * turns + CHECK_OVERLAP_MINUTES;
    const pages = ep.billing === "pages"
      ? pagesToRequest({ ratePerHour: g.rateUpperPerHour, windowMinutes, perPage: p.perPage, maxPages: p.maxPagesPerJob, billing: "pages", learning: g.learning })
      : Math.max(1, Math.min(p.maxPagesPerJob, Math.ceil(expectedResults(g.rateUpperPerHour, windowMinutes) / Math.max(1, p.perPage))));
    usd += (price * pages) / turns;
  }
  return usd;
}
