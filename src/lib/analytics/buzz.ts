// Buzz Analytics math (pure, deterministic, unit-tested). Everything here is
// computed from rows the database returned for stored mentions and coverage
// windows; nothing is estimated or back-filled.
//
// Missing data is never zero: a bucket that no included source monitored is a
// gap (null), and a bucket only some sources covered is marked partial.

export type Bucket = "hour" | "day";

export interface SeriesRow {
  bucket_start: string;
  source: string;
  relevant: number;
  irrelevant: number;
  pending: number;
  posts: number;
  comments: number;
  engagement: number;
}

export interface CoverageRow {
  bucket_start: string;
  /** null = no source had any window overlapping the range. */
  source: string | null;
  covered: number;
  complete: number;
  failed: boolean;
}

export type BucketCoverage = "full" | "partial" | "none";

export interface SeriesPoint {
  start: string;
  /** Relevant mentions in measured sources; null when nothing was monitored (a gap). */
  relevant: number | null;
  irrelevant: number | null;
  pending: number | null;
  bySource: Record<string, number | null>;
  coverage: BucketCoverage;
  /** Sources with no coverage in this bucket (their counts are unknown, not zero). */
  unmeasured: string[];
}

/** A source's bucket is measured when monitoring covered at least half of it, or it has data. */
const MEASURED = 0.5;
const FULL = 0.95;

export function buildSeries(bucketStarts: string[], sources: string[], rows: SeriesRow[], coverage: CoverageRow[]): SeriesPoint[] {
  const key = (b: string, s: string) => `${new Date(b).getTime()}|${s}`;
  const counts = new Map(rows.map((r) => [key(r.bucket_start, r.source), r]));
  const cov = new Map(coverage.filter((c) => c.source).map((c) => [key(c.bucket_start, c.source!), c]));

  return bucketStarts.map((b) => {
    let relevant = 0;
    let irrelevant = 0;
    let pending = 0;
    let measuredAny = false;
    let allFull = sources.length > 0;
    const bySource: Record<string, number | null> = {};
    const unmeasured: string[] = [];
    for (const s of sources) {
      const r = counts.get(key(b, s));
      const c = cov.get(key(b, s));
      const has = (r?.relevant ?? 0) + (r?.irrelevant ?? 0) + (r?.pending ?? 0) > 0;
      const measured = (c?.covered ?? 0) >= MEASURED || has;
      if (!measured) {
        bySource[s] = null;
        unmeasured.push(s);
        allFull = false;
        continue;
      }
      measuredAny = true;
      if ((c?.complete ?? 0) < FULL) allFull = false;
      bySource[s] = r?.relevant ?? 0;
      relevant += r?.relevant ?? 0;
      irrelevant += r?.irrelevant ?? 0;
      pending += r?.pending ?? 0;
    }
    return {
      start: new Date(b).toISOString(),
      relevant: measuredAny ? relevant : null,
      irrelevant: measuredAny ? irrelevant : null,
      pending: measuredAny ? pending : null,
      bySource,
      coverage: !measuredAny ? "none" : allFull ? "full" : "partial",
      unmeasured,
    };
  });
}

export interface Growth {
  current: number;
  previous: number;
  /** Fractional change (0.25 = +25%); null when the previous period had zero. */
  change: number | null;
  label: string;
  /** False when either period wasn't (nearly) fully monitored. */
  reliable: boolean;
}

/** Period-over-period growth with explicit zero handling. */
export function growth(current: number, previous: number, coverage?: { current: number; previous: number }): Growth {
  const reliable = !coverage || (coverage.current >= 0.9 && coverage.previous >= 0.9);
  if (previous === 0 && current === 0) return { current, previous, change: 0, label: "No change", reliable };
  if (previous === 0) return { current, previous, change: null, label: "New activity (none before)", reliable };
  const change = (current - previous) / previous;
  const pct = Math.round(change * 100);
  const label = pct === 0 ? "No change" : `${pct > 0 ? "+" : ""}${pct}%`;
  return { current, previous, change, label, reliable };
}

// --------------------------------------------------------------- Virality

export interface ViralityInput {
  /** Relevant mentions in the last 24 h and the 24 h before that. */
  last24h: number;
  prev24h: number;
  /** Daily average over the baseline (the 28 days before the last 24 h). */
  baselineDaily: number;
  baselineDays: number;
  authors24h: number;
  baselineAuthorsDaily: number;
  /** Engagement per mention, last 24 h vs baseline. */
  engagementPerMention24h: number;
  baselineEngagementPerMention: number;
  /** Distinct platforms with relevant mentions in the last 24 h. */
  platforms24h: number;
}

export interface ViralityFactor {
  key: "growth" | "authors" | "engagement" | "spread" | "acceleration";
  label: string;
  /** 0..1 contribution before weighting. */
  value: number;
  weight: number;
  detail: string;
}

export interface Virality {
  /** 0–100, or null when there isn't enough data to say anything. */
  score: number | null;
  confidence: "low" | "medium" | "high";
  factors: ViralityFactor[];
  note: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Ratio against the product's OWN baseline, mapped to 0..1 on a log scale
 * (×1 → 0, ×2 → 0.33, ×4 → 0.67, ×8+ → 1). A pseudo-count stops tiny products
 * from looking viral on 1 → 3 mentions. Size alone never raises the score.
 */
export function ratioScore(current: number, baseline: number, pseudo = 2): number {
  const r = (current + pseudo) / (baseline + pseudo);
  return clamp01(Math.log2(r) / 3);
}

/**
 * Experimental attention-velocity score. It is NOT sentiment: a product can go
 * viral for bad reasons. Every factor is returned so the number can be explained.
 */
export function viralityScore(i: ViralityInput): Virality {
  if (i.baselineDays < 3 && i.last24h < 5) {
    return { score: null, confidence: "low", factors: [], note: "Not enough monitored history yet (needs at least 3 days)." };
  }
  const factors: ViralityFactor[] = [
    {
      key: "growth", label: "Mention growth", weight: 0.35, value: ratioScore(i.last24h, i.baselineDaily),
      detail: `${i.last24h} in the last 24 h vs ${i.baselineDaily.toFixed(1)}/day usual`,
    },
    {
      key: "authors", label: "New voices", weight: 0.2, value: ratioScore(i.authors24h, i.baselineAuthorsDaily),
      detail: `${i.authors24h} distinct authors in 24 h vs ${i.baselineAuthorsDaily.toFixed(1)}/day usual`,
    },
    {
      key: "engagement", label: "Engagement per mention", weight: 0.15,
      value: i.last24h === 0 ? 0 : ratioScore(i.engagementPerMention24h, i.baselineEngagementPerMention, 1),
      detail: `${i.engagementPerMention24h.toFixed(1)} per mention vs ${i.baselineEngagementPerMention.toFixed(1)} usual`,
    },
    {
      key: "spread", label: "Spread across platforms", weight: 0.15, value: clamp01((i.platforms24h - 1) / 3),
      detail: `${i.platforms24h} platform(s) in 24 h`,
    },
    {
      key: "acceleration", label: "Acceleration", weight: 0.15, value: ratioScore(i.last24h, i.prev24h),
      detail: `${i.last24h} in the last 24 h vs ${i.prev24h} the day before`,
    },
  ];
  const raw = factors.reduce((a, f) => a + f.value * f.weight, 0);
  // Few mentions: damp toward zero so small numbers can't produce a big score.
  const volume = i.last24h / (i.last24h + 5);
  const score = Math.round(100 * raw * volume);
  const confidence = i.baselineDays >= 14 && i.last24h >= 10 ? "high" : i.baselineDays >= 7 ? "medium" : "low";
  return { score, confidence, factors, note: "Experimental. Measures how fast attention is growing against your own usual level — not whether it is positive." };
}

// --------------------------------------------------------------- Spikes

export interface SpikeOptions {
  /** Observed count must reach at least this (avoids 1 → 3 alerts). */
  minCount: number;
  /** Observed must be at least this multiple of the expected level. */
  minRatio: number;
  /** Robust z-score threshold (median/MAD). */
  minZ: number;
  /** Periods needed before a baseline is trusted. */
  minBaseline: number;
  baselineWindow: number;
}

export const DAILY_SPIKES: SpikeOptions = { minCount: 8, minRatio: 2.5, minZ: 3.5, minBaseline: 7, baselineWindow: 28 };
export const HOURLY_SPIKES: SpikeOptions = { minCount: 6, minRatio: 4, minZ: 4, minBaseline: 48, baselineWindow: 168 };

export interface SpikePoint {
  start: string;
  /** null = unmonitored: excluded from baselines and never flagged. */
  value: number | null;
}

export interface Spike {
  start: string;
  observed: number;
  expected: number;
  ratio: number;
  robustZ: number;
  baselinePeriods: number;
  severity: "notable" | "major";
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

/**
 * Rolling-baseline spike detection. For each monitored period the baseline is
 * the previous `baselineWindow` monitored periods: expected = median, spread =
 * MAD (scaled to σ) with a Poisson floor (√expected, at least 1) so a flat
 * history of zeros can't make one mention look extreme. The value must also
 * clearly beat the usual busy days (1.2 × the 90th percentile), so naturally
 * volatile histories don't alert on their ordinary peaks.
 */
export function detectSpikes(points: SpikePoint[], o: SpikeOptions): Spike[] {
  const out: Spike[] = [];
  for (let i = 0; i < points.length; i++) {
    const v = points[i]!.value;
    if (v === null || v < o.minCount) continue;
    const history: number[] = [];
    for (let j = i - 1; j >= 0 && history.length < o.baselineWindow; j--) {
      const h = points[j]!.value;
      if (h !== null) history.push(h);
    }
    if (history.length < o.minBaseline) continue;
    const expected = median(history);
    const mad = median(history.map((h) => Math.abs(h - expected))) * 1.4826;
    const sigma = Math.max(mad, Math.sqrt(Math.max(expected, 1)), 1);
    const z = (v - expected) / sigma;
    const ratio = v / Math.max(expected, 1);
    if (z < o.minZ || ratio < o.minRatio || v <= 1.2 * quantile(history, 0.9)) continue;
    out.push({
      start: points[i]!.start, observed: v, expected, ratio: Number(ratio.toFixed(2)), robustZ: Number(z.toFixed(2)),
      baselinePeriods: history.length, severity: z >= o.minZ * 2 && ratio >= o.minRatio * 2 ? "major" : "notable",
    });
  }
  return out;
}

// --------------------------------------------------------------- Time zones

/** Offset (ms) of `tz` from UTC at instant `t`. */
export function tzOffset(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t));
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(t / 1000) * 1000;
}

/** UTC instant of local midnight (in `tz`) of the day containing `t`, shifted by `addDays`. */
export function zonedDayStart(t: Date, tz: string, addDays = 0): Date {
  const local = new Date(t.getTime() + tzOffset(t.getTime(), tz));
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + addDays);
  // Two passes settle DST transitions.
  let utc = guess - tzOffset(guess, tz);
  utc = guess - tzOffset(utc, tz);
  return new Date(utc);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz);
  } catch {
    return false;
  }
}
