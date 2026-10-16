// Adaptive spike detection (pure). Each product, platform and keyword is
// compared with ITS OWN recent baseline — no universal mention threshold.
//
// For every monitored period (day or hour):
//   * baseline: the previous completely-monitored periods (unmonitored periods are
//     unknown, never zero; partially monitored ones are excluded), winsorized at
//     their 90th percentile so an earlier spike doesn't hide the next one;
//   * expected level: posterior-predictive mean of a Gamma–Poisson model fitted to
//     that baseline, adjusted by a shrunk day-of-week / hour-of-day factor once
//     there is enough history (seasonality);
//   * surprise: upper-tail probability of the observed count under a negative
//     binomial whose variance is the largest of the Poisson-plus-parameter
//     uncertainty and the baseline's own spread (MAD and sample variance of the
//     winsorized baseline) — so sparse or volatile histories need more evidence;
//   * effect size: the observed level must also clearly exceed the expected one
//     (ratio and robust z), so a tiny p-value on a huge baseline doesn't alert on
//     a few percent.
//
// Confidence:
//   CONFIRMED  strong evidence (p < 1e-4), complete coverage of the period and a
//              baseline of at least `minBaseline` complete periods.
//   POSSIBLE   unusual (p < 1e-2) but the period was only partly monitored, or the
//              baseline is short — shown, but never as confirmed.
//   INSUFFICIENT DATA  fewer than `minBaselinePossible` complete baseline periods. Unusual
//              activity against partly monitored history is then still listed, as POSSIBLE.
//
// Historical backfills can't create a "today" spike: counts are by publication
// time, so backfilled mentions land in the periods they were published in.

export interface SpikeSeriesPoint {
  start: string;
  /** Observed count (null = not monitored: excluded, never treated as zero). */
  value: number | null;
  /** The period was completely monitored (counts are not a lower bound). */
  complete: boolean;
}

export interface SpikeConfigV2 {
  granularity: "day" | "hour";
  /** Baseline periods considered (most recent complete ones). */
  baselineWindow: number;
  /** Complete baseline periods needed for a confirmed spike. */
  minBaseline: number;
  /** Complete baseline periods needed to flag anything at all. */
  minBaselinePossible: number;
}

export const DAILY_V2: SpikeConfigV2 = { granularity: "day", baselineWindow: 28, minBaseline: 7, minBaselinePossible: 3 };
export const HOURLY_V2: SpikeConfigV2 = { granularity: "hour", baselineWindow: 168, minBaseline: 48, minBaselinePossible: 12 };

export const P_CONFIRMED = 1e-4;
export const P_POSSIBLE = 1e-2;
export const MIN_RATIO = 1.5;
export const MIN_Z = { confirmed: 3, possible: 2 } as const;

export interface SpikeV2 {
  start: string;
  observed: number;
  expected: number;
  ratio: number;
  robustZ: number;
  pValue: number;
  baselinePeriods: number;
  severity: "notable" | "major";
  confidence: "confirmed" | "possible";
  note: string | null;
}

export interface SpikeEvaluation {
  spikes: SpikeV2[];
  status: "evaluated" | "insufficient_data";
  /** Complete baseline periods available for the latest period. */
  baselinePeriods: number;
  neededPeriods: number;
}

// ------------------------------------------------------------------ math

/** ln Γ(x), Lanczos approximation (|rel. error| < 1e-14 for x > 0). */
export function logGamma(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0]!;
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** P(X ≥ k) for X ~ Poisson(mu). */
export function poissonUpperTail(k: number, mu: number): number {
  if (k <= 0) return 1;
  if (mu <= 0) return 0;
  let cdf = 0;
  for (let i = 0; i < k; i++) cdf += Math.exp(i * Math.log(mu) - mu - logGamma(i + 1));
  return Math.max(0, Math.min(1, 1 - cdf));
}

/** P(X ≥ k) for a negative binomial with the given mean and variance (> mean); Poisson otherwise. */
export function negBinUpperTail(k: number, mean: number, variance: number): number {
  if (k <= 0) return 1;
  if (mean <= 0) return 0;
  if (variance <= mean * 1.0001) return poissonUpperTail(k, mean);
  const r = (mean * mean) / (variance - mean);
  const p = r / (r + mean); // success probability
  const lr = r * Math.log(p);
  const lq = Math.log(1 - p);
  const lgr = logGamma(r);
  let cdf = 0;
  for (let i = 0; i < k; i++) cdf += Math.exp(logGamma(i + r) - lgr - logGamma(i + 1) + lr + i * lq);
  return Math.max(0, Math.min(1, 1 - cdf));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

/** Seasonal slot of a period: weekday for days, hour of day for hours (UTC). */
function slotOf(start: string, g: SpikeConfigV2["granularity"]): number {
  const d = new Date(start);
  return g === "day" ? d.getUTCDay() : d.getUTCHours();
}

// ------------------------------------------------------------------ detection

/**
 * Evaluates every period from `fromIndex` (default: all). Returns spikes and
 * whether the latest period had enough baseline to judge at all.
 */
export function evaluateSpikes(points: SpikeSeriesPoint[], cfg: SpikeConfigV2, fromIndex = 0): SpikeEvaluation {
  const spikes: SpikeV2[] = [];
  let latestBaseline = 0;
  for (let i = Math.max(0, fromIndex); i < points.length; i++) {
    const pt = points[i]!;
    // Baseline: previous complete periods (most recent first), with their seasonal slot.
    let hist: Array<{ v: number; slot: number }> = [];
    for (let j = i - 1; j >= 0 && hist.length < cfg.baselineWindow; j--) {
      const h = points[j]!;
      if (h.value !== null && h.complete) hist.push({ v: h.value, slot: slotOf(h.start, cfg.granularity) });
    }
    if (i === points.length - 1 || pt.value !== null) latestBaseline = hist.length;
    if (pt.value === null) continue;
    // Not enough complete periods: fall back to partly monitored ones (lower bounds) so unusual
    // activity is still shown — but only ever as "possible".
    let fallback = false;
    if (hist.length < cfg.minBaselinePossible) {
      const measured: Array<{ v: number; slot: number }> = [];
      for (let j = i - 1; j >= 0 && measured.length < cfg.baselineWindow; j--) {
        const h = points[j]!;
        // A partly monitored period's count is a lower bound; zero says nothing (it may be a cut-off scan).
        if (h.value !== null && (h.complete || h.value > 0)) measured.push({ v: h.value, slot: slotOf(h.start, cfg.granularity) });
      }
      if (measured.length < cfg.minBaselinePossible) continue;
      hist = measured;
      fallback = true;
    }

    const values = hist.map((h) => h.v);
    const cap = quantile(values, 0.9);
    const wins = values.map((v) => Math.min(v, Math.max(cap, 0)));
    const n = wins.length;
    const sum = wins.reduce((a, b) => a + b, 0);
    // Gamma(½ + Σ, n) posterior on the per-period rate; predictive mean and parameter variance.
    const alpha = sum + 0.5;
    const mu = alpha / n;
    const paramVar = mu + mu / n; // Poisson + uncertainty of the mean (negative-binomial predictive)
    const med = median(wins);
    const mad = median(wins.map((v) => Math.abs(v - med))) * 1.4826;
    // Sample variance too: MAD understates the spread of short, bimodal histories.
    const avg = sum / n;
    const sampleVar = n > 1 ? wins.reduce((t, v) => t + (v - avg) ** 2, 0) / (n - 1) : 0;
    let variance = Math.max(paramVar, mad * mad, sampleVar);

    // Seasonality (shrunk toward 1): needs three full cycles of complete history.
    const cycle = cfg.granularity === "day" ? 7 : 24;
    let factor = 1;
    if (n >= 3 * cycle && mu > 0) {
      const slot = slotOf(pt.start, cfg.granularity);
      const same = hist.filter((h) => h.slot === slot).map((h) => Math.min(h.v, cap));
      const k = 2;
      factor = (same.reduce((a, b) => a + b, 0) + k * mu) / ((same.length + k) * mu);
    }
    const expected = mu * factor;
    variance *= factor;

    const v = pt.value;
    const pValue = negBinUpperTail(v, expected, variance);
    const ratio = (v + 0.5) / (expected + 0.5);
    const z = (v - expected) / Math.sqrt(Math.max(variance, 1e-9));
    const longBaseline = n >= cfg.minBaseline;

    let confidence: SpikeV2["confidence"] | null = null;
    let note: string | null = null;
    if (fallback) {
      // Lower-bound baselines are biased low, so this needs the strong-evidence bar to be listed at all.
      if (pValue < P_CONFIRMED && ratio >= 2 && z >= MIN_Z.confirmed) {
        confidence = "possible";
        note = "Unusual compared with earlier periods, but those were only partly monitored, so this can't be confirmed.";
      }
    } else if (pValue < P_CONFIRMED && ratio >= MIN_RATIO && z >= MIN_Z.confirmed) {
      if (pt.complete && longBaseline) confidence = "confirmed";
      else {
        confidence = "possible";
        note = !pt.complete ? "This period was only partly monitored, so the count may be incomplete." : `Baseline is short (${n} of ${cfg.minBaseline} monitored ${cfg.granularity === "day" ? "days" : "hours"}).`;
      }
    } else if (pValue < P_POSSIBLE && ratio >= MIN_RATIO && z >= MIN_Z.possible && (!pt.complete || !longBaseline)) {
      confidence = "possible";
      note = !pt.complete ? "Unusual, but this period was only partly monitored." : `Unusual, but the baseline is short (${n} of ${cfg.minBaseline} monitored ${cfg.granularity === "day" ? "days" : "hours"}).`;
    }
    if (!confidence) continue;
    spikes.push({
      start: pt.start, observed: v, expected: Math.round(expected * 1000) / 1000, ratio: Math.round(ratio * 100) / 100,
      robustZ: Math.round(z * 100) / 100, pValue: Math.max(pValue, 1e-300), baselinePeriods: n,
      severity: pValue < 1e-8 && ratio >= 3 ? "major" : "notable", confidence, note,
    });
  }
  return {
    spikes,
    status: latestBaseline >= cfg.minBaselinePossible ? "evaluated" : "insufficient_data",
    baselinePeriods: latestBaseline,
    neededPeriods: cfg.minBaselinePossible,
  };
}

/**
 * Product-level point: the total of what was measured, complete only when every
 * platform this product monitors (except those that can never be complete —
 * relevance-ranked or tag-only searches) read the period completely. A platform
 * cut short by a page limit, or not monitored that day, makes the total a lower
 * bound: spikes there are at most "possible".
 */
export function productSpikePoint(
  pt: { start: string; relevant: number | null; bySourceComplete: Record<string, number | null> },
  sources: string[],
  inherentlyPartial: ReadonlySet<string>,
  current: string,
): SpikeSeriesPoint {
  if (pt.relevant === null) return { start: pt.start, value: null, complete: false };
  const strict = sources.filter((s) => !inherentlyPartial.has(s));
  const complete = pt.start !== current && strict.length > 0 && strict.every((s) => pt.bySourceComplete[s] != null);
  return { start: pt.start, value: pt.relevant, complete };
}
