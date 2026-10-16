// Deterministic, template-based explanations of Smart Monitoring decisions
// (no LLM). Only states what the stored metrics show; never calls a platform
// quiet when its coverage is incomplete.

import { discoveryProgress, formatInterval, type ActivityAssessment } from "./adaptive.ts";

export interface ExplainInput {
  name: string;
  rank: number | null;
  assessment: ActivityAssessment;
  n7: number;
  /** This platform had the most relevant mentions of all ranked platforms this week. */
  mostMentions: boolean;
  interval: number;
  recommended: number;
  planLimited: boolean;
  planName?: string;
  boosted: boolean;
  /** V2 (arrival-rate engine): share of this product's relevant mentions, rate, brand-safe bound, risk. */
  v2?: { share: number; arrivalPerDay: number; safeMinutes: number | null; risk: string | null };
}

const mentions = (n: number) => `${n} relevant mention${n === 1 ? "" : "s"}`;

export function explainRank(i: ExplainInput): string {
  const a = i.assessment;
  if (a.phase === "discovery" || i.rank === null) {
    return `${i.name} is new for this product, so it isn't ranked yet. SignalForge is measuring its normal activity first (${discoveryProgress(a.discovery)}).`;
  }
  const growth = a.growthPct !== null && Math.abs(a.growthPct) >= 15
    ? `activity ${a.growthPct > 0 ? "increased" : "decreased"} ${Math.abs(a.growthPct)}% compared with its previous baseline`
    : null;
  const lead = i.v2
    ? `${i.name} ranks #${i.rank}: about ${Math.round(i.v2.share * 100)}% of this product's relevant mentions over the last 4 weeks (${mentions(i.n7)} in the last 7 days)`
    : i.rank === 1 && i.mostMentions && i.n7 > 0
      ? `${i.name} ranks #1 because it generated the most relevant mentions this week (${i.n7})`
      : `${i.name} ranks #${i.rank} with an activity score of ${a.score}/100 and ${mentions(i.n7)} in the last 7 days`;
  const extras = [
    growth,
    a.trend === "unknown" ? "there isn't enough complete coverage yet to compare with earlier weeks" : null,
    a.spikeRecent ? "a spike was detected in the last 3 days" : null,
    a.saturatedRecently ? "recent checks hit their page limit, so the real number may be higher" : null,
  ].filter(Boolean) as string[];
  return `${lead}${extras.length ? ` and ${extras.join("; ")}` : ""}.`;
}

export function explainInterval(i: ExplainInput): string {
  const a = i.assessment;
  const every = `${i.name} is checked every ${formatInterval(i.interval)}`;
  let why: string;
  if (i.boosted) why = "a Launch Boost is active";
  else if (a.phase === "discovery") why = "SignalForge is still learning how active it is";
  else if (a.spikeRecent) why = "activity spiked recently";
  else if (a.saturatedRecently) why = "recent checks returned more results than one check could read";
  else if (a.confidence === "low") why = "coverage is incomplete, so low activity can't be confirmed and it isn't slowed down";
  else if (i.v2 && i.v2.safeMinutes !== null && i.v2.safeMinutes <= i.interval * 1.5) why = "results arrive fast enough that waiting longer could overflow what one check can read";
  else if (i.v2) {
    why = i.v2.arrivalPerDay > 0
      ? `about ${i.v2.arrivalPerDay >= 10 ? Math.round(i.v2.arrivalPerDay) : Math.round(i.v2.arrivalPerDay * 10) / 10} relevant mentions a day arrive here, so each check finds a few new ones`
      : "no relevant mentions have been seen here yet; it's still checked regularly in case that changes";
  }
  else if (a.score >= 55) why = "activity is high";
  else if (a.score >= 25) why = "activity is moderate";
  else if (a.trend === "falling") why = "recent activity is low and falling";
  else if (a.trend === "unknown") why = "recent activity is low (there's no complete earlier baseline to compare with)";
  else why = "recent activity is low and stable";
  if (i.planLimited && !i.boosted) {
    return `${every}, the most often your ${i.planName ? `${i.planName} ` : ""}plan allows (${why}: on its own that would justify every ${formatInterval(i.recommended)}).`;
  }
  return `${every} ${a.phase === "discovery" && !i.boosted ? "while" : "because"} ${why}.`;
}
