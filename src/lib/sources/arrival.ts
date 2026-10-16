// Arrival-rate model (pure, deterministic — no LLM, no ML infrastructure).
//
// Each query group (product × platform × search) has two Gamma–Poisson rate
// posteriors, updated after every check:
//   * raw:      results the search returns per hour (what fills pages → capacity)
//   * relevant: relevant mentions per hour (what the customer cares about)
//
// Why Gamma–Poisson: arrivals are counts over a known exposure (the searched
// window), the conjugate update is two additions, the posterior's spread is an
// honest measure of how little we know (few checks or few events → wide), and
// its upper quantile gives risk-aware scheduling without fixed thresholds.
// Exponential forgetting (half-life 7 days) lets the estimate follow trends.
//
// A check cut short by a page limit ("saturated") only proves a lower bound;
// its exposure is the time span its results actually covered (newest-first
// sources), or half the window when that span is unknown — never the whole
// window, which would understate the rate.

export interface RateEstimate {
  alpha: number;
  /** Exposure in hours (Gamma rate parameter). */
  beta: number;
}

export interface GroupEstimate {
  raw: RateEstimate;
  rel: RateEstimate;
  observations: number;
  saturations: number;
  exposureHours: number;
  lastObservedAt: Date | null;
}

export interface Observation {
  /** Results returned for the window (before relevance filtering). */
  results: number;
  relevant: number;
  windowStart: Date;
  windowEnd: Date;
  /** The search hit its page limit with results left (count is a lower bound). */
  saturated: boolean;
  /** Minutes covered by the returned results (newest to oldest), when known. */
  observedSpanMinutes?: number | null;
  at: Date;
}

/**
 * Weak prior: half an event over two hours — any real data dominates it (it stays in the
 * forgetting floor, so a larger exposure would bias steady-state rates low). Searches with
 * no checks yet are never scheduled or risk-assessed from the prior alone (adaptive-v2).
 */
export const PRIOR: RateEstimate = { alpha: 0.5, beta: 2 };
export const HALF_LIFE_HOURS = 7 * 24;
/** Never trust more exposure than this from one observation (very long first windows). */
const MAX_EXPOSURE_HOURS = 30 * 24;

export function emptyEstimate(): GroupEstimate {
  return { raw: { ...PRIOR }, rel: { ...PRIOR }, observations: 0, saturations: 0, exposureHours: 0, lastObservedAt: null };
}

function forget(e: RateEstimate, factor: number): RateEstimate {
  return { alpha: PRIOR.alpha + (e.alpha - PRIOR.alpha) * factor, beta: PRIOR.beta + (e.beta - PRIOR.beta) * factor };
}

/** Hours of exposure an observation is worth (see header). */
export function effectiveExposureHours(o: Observation): number {
  const window = Math.max(0, (o.windowEnd.getTime() - o.windowStart.getTime()) / 3_600_000);
  let hours = window;
  if (o.saturated) {
    const span = o.observedSpanMinutes != null ? o.observedSpanMinutes / 60 : null;
    hours = span !== null && span > 0 ? Math.min(window, span) : window / 2;
  }
  return Math.min(MAX_EXPOSURE_HOURS, Math.max(1 / 60, hours));
}

export function updateEstimate(e: GroupEstimate, o: Observation): GroupEstimate {
  const dtHours = e.lastObservedAt ? Math.max(0, (o.at.getTime() - e.lastObservedAt.getTime()) / 3_600_000) : 0;
  const f = Math.pow(0.5, dtHours / HALF_LIFE_HOURS);
  const hours = effectiveExposureHours(o);
  const raw = forget(e.raw, f);
  const rel = forget(e.rel, f);
  return {
    raw: { alpha: raw.alpha + Math.max(0, o.results), beta: raw.beta + hours },
    rel: { alpha: rel.alpha + Math.max(0, Math.min(o.relevant, o.results)), beta: rel.beta + hours },
    observations: e.observations + 1,
    saturations: e.saturations + (o.saturated ? 1 : 0),
    exposureHours: e.exposureHours * f + hours,
    lastObservedAt: o.at,
  };
}

export const mean = (e: RateEstimate) => e.alpha / e.beta;
/** Coefficient of variation of the posterior (1/√α): how unsure the estimate is. */
export const uncertainty = (e: RateEstimate) => 1 / Math.sqrt(e.alpha);

/** Standard-normal quantile (Acklam's rational approximation; |error| < 1.2e-9). */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError("p must be in (0, 1)");
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Gamma(α, β) quantile via Wilson–Hilferty (accurate enough for scheduling, α ≥ 0.5). */
export function gammaQuantile(e: RateEstimate, p: number): number {
  const a = Math.max(0.5, e.alpha);
  const z = normalQuantile(p);
  const t = 1 - 1 / (9 * a) + z * Math.sqrt(1 / (9 * a));
  return Math.max(0, (a * t * t * t) / e.beta);
}

/** The rate we plan for: the posterior's 90th percentile (little data → plan for more). */
export const PLANNING_QUANTILE = 0.9;
export const upperRate = (e: RateEstimate) => gammaQuantile(e, PLANNING_QUANTILE);

// ---------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------

/** Hour-of-day profile (24 multipliers averaging 1) from mention counts by UTC hour, or null without enough data. */
export function hourProfile(countsByHour: number[], minTotal = 200): number[] | null {
  const total = countsByHour.reduce((t, n) => t + n, 0);
  if (countsByHour.length !== 24 || total < minTotal) return null;
  // Shrink each hour toward the flat profile (pseudo-count k per hour) so sparse hours don't swing.
  const k = 5;
  const flat = total / 24;
  return countsByHour.map((n) => (n + k) / (flat + k));
}

/** Average profile multiplier over the next `minutes` from `now` (1 without a profile). */
export function profileFactor(profile: number[] | null, now: Date, minutes: number): number {
  if (!profile) return 1;
  const hours = Math.max(1, Math.round(minutes / 60));
  let s = 0;
  for (let i = 0; i < hours; i++) s += profile[(now.getUTCHours() + i) % 24]!;
  return s / hours;
}

// ---------------------------------------------------------------------------
// Capacity and brand-safe intervals
// ---------------------------------------------------------------------------

/** Fill level we keep below: a check should not expect more than this share of what it can retrieve. */
export const SAFE_FILL = 0.8;

/**
 * Longest interval (minutes) at which the results arriving between checks stay
 * within what one check can retrieve, with margin: λT + 2√(λT) ≤ fill · capacity
 * (two Poisson standard deviations above the planned rate). null = no limit
 * (nothing arriving, or unlimited capacity).
 */
export function safeIntervalMinutes(ratePerHour: number, capacity: number | null, fill = SAFE_FILL): number | null {
  if (capacity === null || !Number.isFinite(capacity) || ratePerHour <= 0) return null;
  const x = -1 + Math.sqrt(1 + fill * Math.max(0, capacity));
  if (x <= 0) return 0;
  return Math.round(((x * x) / ratePerHour) * 60);
}

/** Expected results in a window (planning rate × hours). */
export function expectedResults(ratePerHour: number, windowMinutes: number): number {
  return ratePerHour * (windowMinutes / 60);
}

// ---------------------------------------------------------------------------
// Page right-sizing
// ---------------------------------------------------------------------------

export interface PagePlanInput {
  /** Planning rate (results/hour), usually upperRate(raw). */
  ratePerHour: number;
  windowMinutes: number;
  perPage: number;
  /** Most pages one call may request (per-job safety bound). */
  maxPages: number;
  /** "pages": one call bills every requested page; "request": each page is its own call (stops early by itself). */
  billing: "pages" | "request";
  /** No observations yet: request one page and escalate only if it comes back full. */
  learning: boolean;
}

/**
 * Pages to request for a "pages"-billed call: enough for the expected results
 * plus two standard deviations, at least 1, at most the safety bound. Sources
 * billed per request page through results one call at a time and stop when a
 * page isn't full, so they keep their bound (they never pay for empty pages).
 */
export function pagesToRequest(i: PagePlanInput): number {
  if (i.billing === "request") return Math.max(1, i.maxPages);
  if (i.learning) return 1;
  const mu = expectedResults(i.ratePerHour, i.windowMinutes);
  const want = Math.ceil((mu + 2 * Math.sqrt(mu)) / Math.max(1, i.perPage));
  return Math.max(1, Math.min(i.maxPages, want));
}

/**
 * After a full page set came back without reaching the start of the window:
 * pages a single follow-up call should request, extrapolating the density of
 * what came back over the part of the window not yet reached.
 */
export function escalationPages(opts: {
  returned: number; spanMinutes: number | null; remainingMinutes: number; perPage: number; maxPages: number; requested: number;
}): number {
  if (opts.requested >= opts.maxPages) return 0;
  const density = opts.spanMinutes && opts.spanMinutes > 0 ? opts.returned / opts.spanMinutes : null;
  const needed = density === null ? opts.returned * 2 : opts.returned + density * Math.max(0, opts.remainingMinutes);
  const pages = Math.ceil((needed * 1.2) / Math.max(1, opts.perPage));
  return Math.max(opts.requested + 1, Math.min(opts.maxPages, pages));
}
