// Issue prioritisation (pure, deterministic).
//
// Not a mention count. Priority combines:
//   severity  (AI-inferred per post, the issue takes the level most of its posts agree on or above)
//   reach     (independent reporters, log scale: 5 people vs 100 is not 20× more urgent)
//   trend     (last 7 days vs the 7 before; worsening issues rise)
//   recurrence(reported in 3+ distinct weeks)
//   confidence(how sure the classification and grouping are)
// so a critical payment failure from five people outranks a cosmetic request from
// a hundred. Every input is returned as evidence, split into what was observed in
// stored data and what the AI inferred.

import type { Severity } from "./types.ts";

export type PriorityLevel = "critical" | "high" | "medium" | "low";

export interface PriorityInput {
  independentReporters: number;
  mentions: number;
  platforms: string[];
  /** Posts in the last 7 days and the 7 days before that. */
  last7: number;
  prev7: number;
  /** Distinct ISO weeks with posts. */
  weeksActive: number;
  firstSeen: string;
  lastSeen: string;
  /** AI-inferred severity of each member post (null = unknown). */
  severities: Array<Severity | null>;
  /** AI-inferred affected area (majority), if any. */
  area: string | null;
  /** Grouping/classification confidence 0..1. */
  confidence: number;
  negativeShare: number;
}

export interface PriorityResult {
  level: PriorityLevel;
  score: number;
  evidence: {
    observed: {
      independent_reporters: number; mentions: number; platforms: string[];
      last_7_days: number; previous_7_days: number; trend: "new" | "worsening" | "growing" | "steady" | "declining";
      weeks_active: number; recurring: boolean; first_seen: string; last_seen: string; negative_share: number;
    };
    inferred: { severity: Severity | "unknown"; severity_votes: Record<Severity, number>; area: string | null; confidence: number };
    reasons: string[];
  };
}

const WEIGHT: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const ORDER: Severity[] = ["critical", "high", "medium", "low"];

/** The highest severity that at least a third of the labelled posts reach (one alarmist post can't escalate an issue). */
export function issueSeverity(severities: Array<Severity | null>): Severity | null {
  const known = severities.filter((s): s is Severity => !!s);
  if (!known.length) return null;
  for (const level of ORDER) {
    const atLeast = known.filter((s) => WEIGHT[s] >= WEIGHT[level]).length;
    if (atLeast * 3 >= known.length) return level;
  }
  return "low";
}

export function trendOf(last7: number, prev7: number, firstSeen: string, now: Date): PriorityResult["evidence"]["observed"]["trend"] {
  if (now.getTime() - Date.parse(firstSeen) < 7 * 86_400_000) return "new";
  if (last7 >= 3 && last7 >= 2 * Math.max(1, prev7)) return "worsening";
  if (last7 > prev7) return "growing";
  if (last7 < prev7) return "declining";
  return "steady";
}

export function prioritize(i: PriorityInput, now: Date): PriorityResult {
  const severity = issueSeverity(i.severities);
  const sevWeight = severity ? WEIGHT[severity] : 1.5;
  const reach = Math.log2(1 + Math.max(0, i.independentReporters));
  const trend = trendOf(i.last7, i.prev7, i.firstSeen, now);
  const trendFactor = trend === "worsening" ? 1.3 : trend === "growing" || trend === "new" ? 1.15 : trend === "declining" ? 0.85 : 1;
  const recurring = i.weeksActive >= 3;
  const conf = Math.min(1, Math.max(0, i.confidence));
  const score = Math.round(sevWeight * (1 + reach) * trendFactor * (recurring ? 1.1 : 1) * (0.5 + 0.5 * conf) * 100) / 100;

  let level: PriorityLevel = score >= 13 ? "critical" : score >= 8.5 ? "high" : score >= 4.5 ? "medium" : "low";
  // A critical-severity problem confirmed by at least two independent people is never below high.
  if (severity === "critical" && i.independentReporters >= 2 && (level === "medium" || level === "low")) level = "high";
  // Low-severity issues (cosmetic, minor) are never critical, however many people mention them.
  if (severity === "low" && level === "critical") level = "high";

  const votes: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const s of i.severities) if (s) votes[s]++;
  const reasons: string[] = [];
  if (severity) reasons.push(`AI-assessed severity: ${severity} (${votes[severity]} of ${i.severities.filter(Boolean).length} posts)`);
  reasons.push(`${i.independentReporters} independent reporter${i.independentReporters === 1 ? "" : "s"} on ${i.platforms.length} platform${i.platforms.length === 1 ? "" : "s"}`);
  if (trend === "worsening") reasons.push(`Worsening: ${i.last7} posts in the last 7 days vs ${i.prev7} the week before`);
  else if (trend === "new") reasons.push("First reported in the last 7 days");
  else if (trend === "declining") reasons.push(`Declining: ${i.last7} posts in the last 7 days vs ${i.prev7} the week before`);
  if (recurring) reasons.push(`Recurring: reported in ${i.weeksActive} different weeks`);
  if (conf < 0.6) reasons.push("Low confidence in the grouping or labels");

  return {
    level,
    score,
    evidence: {
      observed: {
        independent_reporters: i.independentReporters, mentions: i.mentions, platforms: i.platforms,
        last_7_days: i.last7, previous_7_days: i.prev7, trend, weeks_active: i.weeksActive, recurring,
        first_seen: i.firstSeen, last_seen: i.lastSeen, negative_share: Math.round(i.negativeShare * 100) / 100,
      },
      inferred: { severity: severity ?? "unknown", severity_votes: votes, area: i.area, confidence: Math.round(conf * 100) / 100 },
      reasons,
    },
  };
}

/** Observed time facts from member publication dates. */
export function timeFacts(dates: string[], now: Date): { last7: number; prev7: number; weeksActive: number } {
  const t = now.getTime();
  let last7 = 0;
  let prev7 = 0;
  const weeks = new Set<number>();
  for (const d of dates) {
    const ms = Date.parse(d);
    const age = t - ms;
    if (age >= 0 && age < 7 * 86_400_000) last7++;
    else if (age >= 7 * 86_400_000 && age < 14 * 86_400_000) prev7++;
    weeks.add(Math.floor(ms / (7 * 86_400_000)));
  }
  return { last7, prev7, weeksActive: weeks.size };
}
