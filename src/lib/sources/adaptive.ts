// Automatic Smart Monitoring (pure, deterministic — no LLM).
//
// 1. assessActivity: a 0–100 activity score per Product + Platform from stored
//    data only (no extra API calls). A base score from volume, history, unique
//    authors, engagement and spikes (log-scaled with caps, so one very busy
//    platform can't dominate; engagement only vs the platform's own history),
//    plus ± momentum for growth and acceleration. Signals that can't be measured (no
//    author ids, too little history, incomplete coverage) are left out and the
//    remaining weights are rescaled — never filled with guesses.
// 2. decidePlatformInterval: score → 1/2/3/4/6/12/24 h, then safeguards
//    (spikes, page-limit saturation, audit misses, per-platform maximum), then
//    hysteresis (speed up fast, slow down one step at a time only after activity
//    stays low, never while coverage is incomplete or a platform is new), then
//    the plan / Launch Boost / source limits. Every decision carries reasons.
// 3. A new platform starts in a discovery phase at a moderate interval until
//    enough checks and coverage exist to rank it.

export const INTERVAL_STEPS = [60, 120, 180, 240, 360, 720, 1440] as const;
export const MAX_INTERVAL = 1440;

export type Confidence = "high" | "medium" | "low";
export type Trend = "rising" | "stable" | "falling" | "new" | "unknown";
export type Phase = "discovery" | "ranked";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function snapUp(minutes: number): number {
  return INTERVAL_STEPS.find((s) => s >= minutes) ?? MAX_INTERVAL;
}

export function step(minutes: number, delta: number): number {
  const i = INTERVAL_STEPS.indexOf(snapUp(minutes) as (typeof INTERVAL_STEPS)[number]);
  return INTERVAL_STEPS[Math.max(0, Math.min(INTERVAL_STEPS.length - 1, i + delta))]!;
}

export function formatInterval(minutes: number): string {
  if (minutes >= 2880 && minutes % 1440 === 0) return `${minutes / 1440} days`;
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

// ---------------------------------------------------------------------------
// Activity score
// ---------------------------------------------------------------------------

/** Stored-data signals for one product + platform (see private.platform_activity_stats). */
export interface ActivityStats {
  /** Relevant original mentions published in the last 24 h / the 24 h before / 7 days / 28 days. */
  n24: number;
  prev24: number;
  n7: number;
  n28: number;
  /** Distinct author ids in the last 7 days, and how many of those mentions carried an author id. */
  authors7: number;
  authored7: number;
  /** Mentions in 28 days with an engagement value, and 7-day mentions at or above the platform's own 75th percentile. */
  engHistory: number;
  engHigh7: number;
  spikeRecent: boolean;
  /** Share of the last 7 days covered by complete / any (complete or partial) checks. */
  completeShare7: number;
  coveredShare7: number;
  /** Share of the 21 days before that covered by complete checks (the baseline period). */
  completeSharePrior: number;
  firstMonitoredAt: Date | null;
  completedChecks: number;
  lastSuccessAt: Date | null;
  saturatedAt: Date | null;
  failures: number;
  auditMissed: number;
}

export type ComponentId = "volume" | "baseline" | "growth" | "acceleration" | "authors" | "engagement" | "spikes" | "feedback";

export interface ScoreComponent {
  id: ComponentId;
  label: string;
  /** "base": share of 100 points (rescaled over measurable signals); "momentum": ± adjustment. */
  kind: "base" | "momentum";
  weight: number;
  /** 0..1 (momentum: 0.5 = no change), or null when it can't be measured (left out of the score). */
  value: number | null;
  /** Points contributed to the score (momentum points can be negative). */
  points: number;
  detail: string;
}

export interface ActivityAssessment {
  phase: Phase;
  score: number;
  components: ScoreComponent[];
  baselineWeekly: number | null;
  growthPct: number | null;
  trend: Trend;
  confidence: Confidence;
  spikeRecent: boolean;
  saturatedRecently: boolean;
  auditMissed: number;
  discovery: { checks: number; neededChecks: number; days: number; neededDays: number } | null;
  notes: string[];
}

/** Base weights (sum 100, rescaled over what's measurable) and momentum weights (± points). */
export const WEIGHTS: Record<ComponentId, number> = {
  volume: 45, baseline: 20, authors: 15, engagement: 10, spikes: 10, feedback: 10,
  growth: 15, acceleration: 10,
};
const MOMENTUM = new Set<ComponentId>(["growth", "acceleration"]);
/** Relevant mentions per week that earn the full volume/baseline value (≈50 a day). */
export const VOLUME_CAP = 350;
export const AUTHORS_CAP = 100;
/** Score floor while recent checks hit their page limit (counts are lower bounds). */
export const SATURATION_FLOOR = 55;
export const DISCOVERY_MIN_CHECKS = 3;
export const DISCOVERY_DAYS = 7;
const RECENT_SATURATION_MS = 3 * DAY;

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const logScale = (n: number, cap: number) => clamp(Math.log1p(Math.max(0, n)) / Math.log1p(cap));
/** ratio 1 → 0.5, ×2 → 1, ÷2 → 0. */
const ratioScale = (ratio: number) => clamp(0.5 + Math.log2(ratio) / 2);
/** Small samples pull a signal towards `to` (0 = nothing there; 0.5 = no change). */
const damp = (v: number, n: number, k: number, to = 0) => to + (v - to) * (n / (n + k));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function assessActivity(s: ActivityStats, opts: { now: Date; inherentlyPartial?: boolean }): ActivityAssessment {
  const notes: string[] = [];
  const baselineKnown = s.completeSharePrior >= 0.5;
  const bw = baselineKnown ? Math.max(0, s.n28 - s.n7) / 3 : null;
  const daily7 = s.n7 / 7;
  const authorsKnown = s.n7 === 0 || s.authored7 >= s.n7 * 0.5;
  const engagementKnown = s.engHistory >= 8;

  const parts: Array<Omit<ScoreComponent, "points" | "weight" | "kind">> = [
    { id: "volume", label: "Recent relevant mentions", value: logScale(s.n7, VOLUME_CAP), detail: `${plural(s.n7, "relevant mention")} in the last 7 days` },
    {
      id: "baseline", label: "Historical activity", value: bw === null ? null : logScale(bw, VOLUME_CAP),
      detail: bw === null ? "Not enough complete coverage before the last 7 days" : `About ${round1(bw)} a week in the 3 weeks before`,
    },
    {
      id: "growth", label: "Growth", value: bw === null ? null : damp(ratioScale((s.n7 + 2) / (bw + 2)), s.n7 + bw, 5, 0.5),
      detail: bw === null ? "Needs historical activity" : `${s.n7} this week vs about ${round1(bw)} a week before`,
    },
    {
      id: "acceleration", label: "Acceleration", value: damp(ratioScale((s.n24 + 1) / (daily7 + 1)), s.n24 + daily7, 3, 0.5),
      detail: `${s.n24} in the last 24 h vs about ${round1(daily7)} a day this week`,
    },
    {
      id: "authors", label: "Unique authors", value: authorsKnown ? logScale(s.authors7, AUTHORS_CAP) : null,
      detail: authorsKnown ? `${plural(s.authors7, "distinct author")} in 7 days` : "This platform doesn't expose author ids for most mentions",
    },
    {
      id: "engagement", label: "Engagement (vs this platform's own history)",
      value: engagementKnown ? (s.n7 > 0 ? damp(clamp(s.engHigh7 / s.n7 / 0.5), s.n7, 3) : 0) : null,
      detail: engagementKnown ? `${s.engHigh7} of ${s.n7} recent mentions in this platform's top quarter for engagement` : "Not enough engagement history on this platform",
    },
    { id: "spikes", label: "Recent spikes", value: s.spikeRecent ? 1 : 0, detail: s.spikeRecent ? "A spike was detected in the last 3 days" : "No spike in the last 3 days" },
    { id: "feedback", label: "Important feedback", value: null, detail: "Needs AI feedback classification (not available yet)" },
  ];
  const available = parts.reduce((t, p) => t + (p.value === null || MOMENTUM.has(p.id) ? 0 : WEIGHTS[p.id]), 0);
  const components: ScoreComponent[] = parts.map((p) => {
    const kind = MOMENTUM.has(p.id) ? "momentum" as const : "base" as const;
    const points = p.value === null ? 0
      : kind === "momentum" ? round1(WEIGHTS[p.id] * (p.value - 0.5) * 2)
      : available === 0 ? 0 : round1((100 * WEIGHTS[p.id] * p.value) / available);
    return { ...p, kind, weight: WEIGHTS[p.id], points };
  });
  let score = Math.round(components.reduce((t, c) => t + c.points, 0));

  const saturatedRecently = Boolean(s.saturatedAt && opts.now.getTime() - s.saturatedAt.getTime() < RECENT_SATURATION_MS);
  if (saturatedRecently && score < SATURATION_FLOOR) {
    score = SATURATION_FLOOR;
    notes.push("Recent checks hit their page limit, so real activity is at least this high");
  }
  score = clamp(score, 0, 100);

  let confidence: Confidence;
  if (s.completedChecks === 0 || s.coveredShare7 < 0.5 || s.failures >= 2) confidence = "low";
  else if (opts.inherentlyPartial || s.failures === 1 || saturatedRecently || s.completeShare7 < 0.9 || s.auditMissed > 0) confidence = "medium";
  else confidence = "high";

  const monitoredDays = s.firstMonitoredAt ? (opts.now.getTime() - s.firstMonitoredAt.getTime()) / DAY : 0;
  const learning = s.completedChecks < DISCOVERY_MIN_CHECKS || (monitoredDays < DISCOVERY_DAYS && s.completeShare7 < 0.8);
  const phase: Phase = learning ? "discovery" : "ranked";

  let trend: Trend;
  if (phase === "discovery") trend = "new";
  else if (bw === null) trend = "unknown";
  else if (s.n7 >= 3 && s.n7 >= bw * 1.3 + 1) trend = "rising";
  else if (bw >= 3 && s.n7 <= bw * 0.7) trend = "falling";
  else trend = "stable";

  return {
    phase, score, components, baselineWeekly: bw === null ? null : round1(bw),
    growthPct: bw !== null && bw >= 1 ? Math.round(((s.n7 - bw) / bw) * 100) : null,
    trend, confidence, spikeRecent: s.spikeRecent, saturatedRecently, auditMissed: s.auditMissed,
    discovery: learning
      ? { checks: s.completedChecks, neededChecks: DISCOVERY_MIN_CHECKS, days: Math.floor(monitoredDays), neededDays: DISCOVERY_DAYS }
      : null,
    notes,
  };
}

/** Plain-language progress through discovery. */
export function discoveryProgress(d: ActivityAssessment["discovery"]): string {
  if (!d) return "starting";
  if (d.checks < d.neededChecks) return `${d.checks} of ${d.neededChecks} checks so far`;
  return `day ${Math.min(d.days + 1, d.neededDays)} of ${d.neededDays}, or sooner once a full week is completely covered`;
}

/** Ranks scored platforms (discovery platforms are unranked, not ranked last). */
export function rankPlatforms<T extends { platform: string; assessment: ActivityAssessment; n7: number }>(rows: T[]): Map<string, number> {
  const ranked = rows
    .filter((r) => r.assessment.phase === "ranked")
    .sort((a, b) => b.assessment.score - a.assessment.score || b.n7 - a.n7 || a.platform.localeCompare(b.platform));
  return new Map(ranked.map((r, i) => [r.platform, i + 1]));
}

// ---------------------------------------------------------------------------
// Refresh interval
// ---------------------------------------------------------------------------

/** Starting rule: activity score → interval. */
export function scoreInterval(score: number): number {
  if (score >= 85) return 60;
  if (score >= 70) return 120;
  if (score >= 55) return 180;
  if (score >= 40) return 240;
  if (score >= 25) return 360;
  if (score >= 10) return 720;
  return 1440;
}

/** Interval while a platform is new (activity may still lower it). */
export const DISCOVERY_INTERVAL = { free: 240, paid: 360 } as const;
/** Score points of slack before slowing down (dead band against flapping at a boundary). */
export const HYSTERESIS_POINTS = 5;
/** Activity must stay low this long (and ≥ 2 intervals) before an interval lengthens one step. */
export const SLOW_DOWN_AFTER_MS = DAY;
/** During a Launch Boost the interval is at most this (and may go down to the plan's boost minimum). */
export const BOOST_MAX_INTERVAL = 180;

export interface IntervalInput {
  now: Date;
  assessment: ActivityAssessment;
  paid: boolean;
  planName?: string;
  planMinMinutes: number;
  /** Hard floor imposed by the source itself (e.g. YouTube's shared search quota). */
  sourceMinMinutes?: number;
  /** Never check less often than this on this platform. */
  maxIntervalMinutes: number;
  boost: { minMinutes: number; endsAt: Date } | null;
  /** Last decision's recommended (engine) interval and slow-down timer. */
  previous: { recommended: number; pendingSince: Date | null } | null;
}

export interface IntervalDecision {
  /** What activity justifies, after safeguards and hysteresis, before plan/source/boost limits. */
  recommended: number;
  /** What the scheduler uses. */
  interval: number;
  planLimited: boolean;
  pendingSince: Date | null;
  reasons: string[];
}

function target(a: ActivityAssessment, score: number, i: IntervalInput, reasons: string[] | null): number {
  const say = (r: string) => reasons?.push(r);
  let t: number;
  if (a.phase === "discovery") {
    const start = i.paid ? DISCOVERY_INTERVAL.paid : DISCOVERY_INTERVAL.free;
    t = Math.min(start, scoreInterval(score));
    say(`New on this product: learning its normal activity (${discoveryProgress(a.discovery)})`);
  } else {
    t = scoreInterval(score);
    say(`Activity score ${score}/100`);
    if (i.paid && score < 40 && !a.spikeRecent) {
      t = step(t, +1);
      say("Paid platform with low activity: checked a little less often to conserve the paid-source allowance");
    }
  }
  if (a.spikeRecent && t > 120) {
    t = 120;
    say("A spike was detected in the last 3 days");
  }
  if (a.saturatedRecently) {
    t = step(t, -1);
    say("Recent checks hit their page limit, so it's checked sooner to avoid missing mentions");
  }
  if (a.auditMissed > 0) {
    t = step(t, -1);
    say(`A completeness audit found ${plural(a.auditMissed, "mention")} regular checks had missed`);
  }
  if (t > i.maxIntervalMinutes) {
    t = snapUp(i.maxIntervalMinutes);
    say(`Never checked less often than every ${formatInterval(t)} on this platform`);
  }
  return t;
}

export function decidePlatformInterval(i: IntervalInput): IntervalDecision {
  const a = i.assessment;
  const reasons: string[] = [];
  const wanted = target(a, a.score, i, reasons);
  // The same rules with a few more points: if that would still be slower, the drop is real, not boundary noise.
  const wantedWithSlack = target(a, Math.min(100, a.score + HYSTERESIS_POINTS), i, null);

  let recommended = wanted;
  let pendingSince: Date | null = null;
  const prev = i.previous?.recommended ?? null;
  if (prev !== null) {
    if (wanted < prev) {
      // Speed up quickly: up to two steps per decision, all the way at once for spikes and saturation.
      const urgent = a.spikeRecent || a.saturatedRecently;
      recommended = urgent ? wanted : Math.max(wanted, step(prev, -2));
      reasons.push("Activity increased, so it's checked more often");
    } else if (wanted > prev) {
      if (a.phase === "discovery") {
        recommended = prev;
        reasons.push("Kept the current interval while it's still learning");
      } else if (a.confidence === "low") {
        recommended = prev;
        reasons.push("Kept the current interval: coverage is incomplete, so low activity can't be confirmed");
      } else if (wantedWithSlack <= prev) {
        recommended = prev;
        reasons.push("Activity is close to the boundary, so the interval stays the same");
      } else {
        const since = i.previous?.pendingSince ?? i.now;
        const wait = Math.max(SLOW_DOWN_AFTER_MS, 2 * prev * 60_000);
        if (i.now.getTime() - since.getTime() >= wait) {
          recommended = step(prev, +1);
          reasons.push(`Activity stayed low for ${Math.round(wait / HOUR)} h, so it slows down one step`);
        } else {
          recommended = prev;
          pendingSince = since;
          reasons.push(`Activity is lower; intervals only lengthen after it stays low for ${Math.round(wait / HOUR)} h`);
        }
      }
    }
  }

  let interval = recommended;
  let planLimited = false;
  const boosted = Boolean(i.boost && i.boost.endsAt > i.now);
  let floor = i.planMinMinutes;
  if (boosted) {
    interval = Math.min(interval, BOOST_MAX_INTERVAL);
    floor = i.boost!.minMinutes;
    reasons.unshift(`Launch Boost active until ${i.boost!.endsAt.toISOString().slice(0, 16).replace("T", " ")} UTC`);
  }
  if (interval < floor) {
    interval = snapUp(floor);
    planLimited = !boosted;
    reasons.push(boosted
      ? `Launch Boost checks at most every ${formatInterval(interval)} on your plan`
      : `Your ${i.planName ? `${i.planName} ` : ""}plan checks each platform at most every ${formatInterval(interval)}`);
  }
  if (i.sourceMinMinutes && interval < i.sourceMinMinutes) {
    interval = snapUp(i.sourceMinMinutes);
    reasons.push(`This source allows a check at most every ${formatInterval(interval)}`);
  }
  interval = Math.min(snapUp(interval), MAX_INTERVAL);
  return { recommended, interval, planLimited, pendingSince, reasons };
}

/** Next run of one query group: the platform interval, or a quicker retry after failures. */
export function nextRunAt(now: Date, intervalMinutes: number, consecutiveFailures: number): Date {
  if (consecutiveFailures > 0) {
    // The checkpoint didn't advance, so the retry re-searches the gap.
    return new Date(now.getTime() + Math.min(intervalMinutes, 30 * 2 ** (consecutiveFailures - 1)) * 60_000);
  }
  return new Date(now.getTime() + intervalMinutes * 60_000);
}

/** A check is overdue (scheduler outage, stuck job) when nothing succeeded for two intervals plus an hour. */
export function isOverdue(lastSuccessAt: Date | null, intervalMinutes: number, now: Date): boolean {
  return Boolean(lastSuccessAt && now.getTime() - lastSuccessAt.getTime() > (2 * intervalMinutes + 60) * 60_000);
}

/** Audits re-search a wider window periodically to measure what regular checks miss. */
export function auditDue(lastAuditAt: Date | null, paid: boolean, score: number | null, now: Date): boolean {
  const days = paid && (score ?? 0) < 25 ? 14 : 7;
  return !lastAuditAt || now.getTime() - lastAuditAt.getTime() >= days * DAY;
}

/** Comment-expansion parents per run: more for busier platforms (each may be a paid request). */
export function expansionsPerRun(score: number | null): number {
  if (score === null || score < 40) return 1;
  if (score < 70) return 2;
  if (score < 85) return 3;
  return 4;
}

/** Plain-language freshness: typical delay before a new mention shows up. */
export function expectedDiscoveryMinutes(intervalMinutes: number, indexingLagMinutes = 15): { typical: number; worst: number } {
  return { typical: Math.round(intervalMinutes / 2 + indexingLagMinutes), worst: intervalMinutes + indexingLagMinutes };
}

// ---------------------------------------------------------------------------
// Efficiency
// ---------------------------------------------------------------------------

export interface GroupObservation {
  /** Hours this query group was enabled and monitored within the window. */
  observedHours: number;
  /** Checks it actually ran in that time (fetches, not skips). */
  checks: number;
}

export interface Efficiency {
  checks: number;
  hourlyBaseline: number;
  avoided: number;
  /** null until there's enough history to compare honestly. */
  percentFewer: number | null;
  observedHours: number;
}

/** Actual checks vs. checking every monitored query group once an hour over the same time. */
export function monitoringEfficiency(groups: GroupObservation[], opts: { minHours?: number; minChecks?: number } = {}): Efficiency {
  const checks = groups.reduce((t, g) => t + g.checks, 0);
  const hourlyBaseline = groups.reduce((t, g) => t + Math.max(0, Math.floor(g.observedHours)), 0);
  const observedHours = groups.reduce((m, g) => Math.max(m, g.observedHours), 0);
  const avoided = Math.max(0, hourlyBaseline - checks);
  const enough = observedHours >= (opts.minHours ?? 24) && checks >= (opts.minChecks ?? 3) && hourlyBaseline > 0;
  return { checks, hourlyBaseline, avoided, percentFewer: enough ? Math.round((avoided / hourlyBaseline) * 100) : null, observedHours };
}
