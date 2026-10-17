import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assessActivity, isOverdue,
  type ActivityAssessment, type IntervalDecision,
} from "@/lib/sources/adaptive";
import {
  assessRisk, decidePlatformIntervalV2, importanceShares, paceForBudgetSafely, rankByImportance, snapDown,
  type CollectionRisk, type GroupModel, type PlatformModelDecision,
} from "@/lib/sources/adaptive-v2";
import { emptyEstimate, hourProfile, upperRate, type GroupEstimate } from "@/lib/sources/arrival";
import { collectionProfile, INHERENTLY_PARTIAL, planningCapacity } from "@/lib/sources/collection-profile";
import { devMonitoringFloor } from "@/lib/domain/dev-entitlement";
import { applyKeywordTarget, estimateCheckCostV2 } from "@/lib/sources/entitlements";
import { DEFAULT_KEYWORD_TARGET_MINUTES, keywordIntervalMinutes, rotationNextRun, rotationTurns, type Rotation } from "@/lib/sources/keyword-plan";
import { INTERVAL_STEPS } from "@/lib/sources/adaptive";
import { formatInterval } from "@/lib/sources/adaptive";
import { isPublicSource } from "@/lib/sources/registry";
import type { PublicSourceId } from "@/lib/sources/types";
import { getAdapters, paidCollectionEnabled } from "./sources";

export { INHERENTLY_PARTIAL };

/** Never check less often than this, however quiet a platform looks (missed-mention safeguard). */
export const PLATFORM_MAX_INTERVAL: Record<PublicSourceId, number> = {
  hackernews: 720, github: 720, stackexchange: 720, bluesky: 720,
  youtube: 1440, dev: 1440, app_store: 1440, google_play: 1440, discord: 720,
  reddit: 1440, x: 1440, linkedin: 1440, tiktok: 1440, instagram: 1440, facebook: 1440,
  substack: 1440, web: 1440, news: 1440, trustpilot: 1440,
};

/** Floors imposed by the source itself. */
export const SOURCE_MIN_INTERVAL: Partial<Record<PublicSourceId, number>> = { youtube: 1440 };

interface StatsRow {
  platform: string;
  n24: number; prev24: number; n7: number; n28: number;
  authors7: number; authored7: number;
  eng_history: number; eng_high7: number;
  spike_recent: boolean;
  complete_share7: number; covered_share7: number; complete_share_prior: number;
  first_monitored_at: string | null; completed_checks: number;
  last_success_at: string | null; next_run_at: string | null; saturated_at: string | null;
  failures: number; audit_missed: number; interval_minutes: number | null;
}

interface PreviousRow {
  platform: string;
  recommended_interval: number;
  interval_minutes: number;
  lengthen_pending_since: string | null;
}

export interface PlatformDecision {
  platform: PublicSourceId;
  rank: number | null;
  assessment: ActivityAssessment;
  decision: IntervalDecision;
  n7: number;
  keywordTargetMinutes: number;
  slowestKeywordMinutes: number;
  keywordConflict: string | null;
  budgetPaced: boolean;
  model: PlatformModelDecision;
  importanceShare: number;
  risk: CollectionRisk;
  riskDetail: string | null;
  /** Brand-safe interval per query group (minutes), for out-of-turn checks of rotating searches at risk. */
  groupSafeMinutes: Map<string, number | null>;
}

interface ArrivalRow {
  query_id: string; raw_alpha: number; raw_beta: number; rel_alpha: number; rel_beta: number;
  observations: number; saturations: number; exposure_hours: number; last_observed_at: string | null;
}

export function estimateFromRow(r: ArrivalRow | undefined): GroupEstimate {
  if (!r) return emptyEstimate();
  return {
    raw: { alpha: Number(r.raw_alpha), beta: Number(r.raw_beta) }, rel: { alpha: Number(r.rel_alpha), beta: Number(r.rel_beta) },
    observations: r.observations, saturations: r.saturations, exposureHours: Number(r.exposure_hours),
    lastObservedAt: r.last_observed_at ? new Date(r.last_observed_at) : null,
  };
}

interface ScheduleCtx {
  workspace_id: string; archived: boolean; plan_name: string; plan_min_minutes: number; boost_min_minutes: number;
  keyword_target_minutes?: number; paid_allowance_usd?: number; allowance_paused_until?: string | null;
}

interface EnabledQuery {
  id: string; provider: string; stream: string; params: { rotation?: Rotation } | null; interval_minutes: number | null;
  next_run_at: string; last_success_at: string | null; consecutive_failures: number;
}

const date = (s: string | null) => (s ? new Date(s) : null);

/**
 * Recomputes activity scores, ranks and intervals for every monitored platform
 * of a product from stored data (no API calls), stores them, logs interval
 * changes, and applies them to the query groups' schedule. `exceptQueryId`
 * skips the query group whose run is finishing (it schedules itself).
 */
export async function refreshActivity(
  admin: SupabaseClient,
  productId: string,
  opts: { exceptQueryId?: string; now?: Date } = {},
): Promise<Map<PublicSourceId, PlatformDecision>> {
  const now = opts.now ?? new Date();
  const since28 = new Date(now.getTime() - 28 * 86_400_000).toISOString();
  const [{ data: stats, error }, { data: ctx }, { data: boosts }, { data: prevRows }, { data: queryRows }, { data: arrivalRows }, { data: hours }] = await Promise.all([
    admin.rpc("svc_platform_activity_stats", { p_product_id: productId }),
    admin.rpc("svc_schedule_context", { p_product_id: productId, p_platform: "reddit" }),
    admin.from("launch_boosts").select("platforms, ends_at").eq("product_id", productId).is("canceled_at", null)
      .lte("starts_at", now.toISOString()).gt("ends_at", now.toISOString()),
    admin.from("platform_activity").select("platform, recommended_interval, interval_minutes, lengthen_pending_since").eq("product_id", productId),
    admin.from("monitoring_queries")
      .select("id, provider, stream, params, interval_minutes, next_run_at, last_success_at, consecutive_failures")
      .eq("product_id", productId).eq("enabled", true).is("competitor_id", null),
    admin.from("arrival_estimates")
      .select("query_id, raw_alpha, raw_beta, rel_alpha, rel_beta, observations, saturations, exposure_hours, last_observed_at")
      .eq("product_id", productId),
    // Hour-of-day profile (product-wide; per-platform samples are too small).
    admin.from("mentions").select("published_at").eq("product_id", productId).eq("dedup_kind", "original")
      .in("relevance_status", ["relevant", "user_relevant"]).eq("published_at_estimated", false)
      .gte("published_at", since28).order("published_at", { ascending: false }).limit(5000),
  ]);
  if (error) throw new Error(`Couldn't load activity stats (${error.code ?? "db"})`);
  const c = ctx as ScheduleCtx | null;
  const queries = (queryRows ?? []) as EnabledQuery[];
  const out = new Map<PublicSourceId, PlatformDecision>();
  if (!c || c.archived) return out;

  const adapters = getAdapters();
  // Development-only: listed workspaces may test faster intervals on `next dev` (budgets and rate limits unchanged).
  const devFloor = devMonitoringFloor(process.env, c.workspace_id);
  const planMin = devFloor !== null ? Math.min(c.plan_min_minutes, devFloor) : c.plan_min_minutes;
  const planName = devFloor !== null && devFloor < c.plan_min_minutes ? `${c.plan_name} + development entitlement` : c.plan_name;
  const prev = new Map(((prevRows ?? []) as PreviousRow[]).map((r) => [r.platform, r]));
  const arrival = new Map(((arrivalRows ?? []) as ArrivalRow[]).map((r) => [r.query_id, r]));
  const byHour = new Array<number>(24).fill(0);
  for (const m of (hours ?? []) as Array<{ published_at: string }>) byHour[new Date(m.published_at).getUTCHours()]!++;
  const profile = hourProfile(byHour);
  const boostEnds = new Map<string, Date>();
  for (const b of (boosts ?? []) as Array<{ platforms: string[]; ends_at: string }>) {
    for (const p of b.platforms) {
      const end = new Date(b.ends_at);
      if (!boostEnds.has(p) || boostEnds.get(p)! < end) boostEnds.set(p, end);
    }
  }

  const rows = ((stats ?? []) as StatsRow[]).filter((r) => isPublicSource(r.platform));
  const scored = rows.map((r) => {
    const platform = r.platform as PublicSourceId;
    // Measured signals, kept for the explanation panel (no longer mapped to intervals).
    const assessment = assessActivity({
      n24: r.n24, prev24: r.prev24, n7: r.n7, n28: r.n28, authors7: r.authors7, authored7: r.authored7,
      engHistory: r.eng_history, engHigh7: r.eng_high7, spikeRecent: r.spike_recent,
      completeShare7: Number(r.complete_share7), coveredShare7: Number(r.covered_share7), completeSharePrior: Number(r.complete_share_prior),
      firstMonitoredAt: date(r.first_monitored_at), completedChecks: r.completed_checks,
      lastSuccessAt: date(r.last_success_at), saturatedAt: date(r.saturated_at), failures: r.failures, auditMissed: r.audit_missed,
    }, { now, inherentlyPartial: INHERENTLY_PARTIAL.has(platform) });
    return { platform, assessment, n7: r.n7, row: r };
  });

  // Activity importance: this product's own platform mix (28 days), smoothed.
  const shares = importanceShares(Object.fromEntries(scored.map((s) => [s.platform, s.row.n28])));

  const target = Number(c.keyword_target_minutes ?? DEFAULT_KEYWORD_TARGET_MINUTES);
  const decided = scored.map((s) => {
    const p = prev.get(s.platform);
    const end = boostEnds.get(s.platform);
    const paid = Boolean(adapters[s.platform].paid);
    const mine = queries.filter((q) => q.provider === s.platform);
    const groups: GroupModel[] = mine.map((q) => {
      const cap = planningCapacity(collectionProfile(s.platform, q.stream));
      return { id: q.id, estimate: estimateFromRow(arrival.get(q.id)), capacity: cap.capacity, resumable: cap.resumable, turns: q.params?.rotation ? rotationTurns(q.params.rotation) : 1 };
    });
    const model = decidePlatformIntervalV2({
      now, paid, planName, groups, importanceShare: shares[s.platform] ?? null, platformsMonitored: scored.length, profile,
      confidence: s.assessment.confidence, spikeRecent: s.assessment.spikeRecent, auditMissed: s.assessment.auditMissed,
      planMinMinutes: planMin, sourceMinMinutes: SOURCE_MIN_INTERVAL[s.platform], maxIntervalMinutes: PLATFORM_MAX_INTERVAL[s.platform],
      boost: end ? { minMinutes: c.boost_min_minutes, endsAt: end } : null,
      previous: p ? { recommended: p.recommended_interval, pendingSince: date(p.lengthen_pending_since) } : null,
    });
    // The page shows "learning" while the arrival model is (it replaces the score's discovery phase).
    if (model.learning) s.assessment.phase = "discovery";
    else if (s.assessment.phase === "discovery") {
      s.assessment.phase = "ranked";
      s.assessment.discovery = null;
    }
    const decision: IntervalDecision = {
      recommended: model.recommended, interval: model.interval, planLimited: model.planLimited, pendingSince: model.pendingSince, reasons: model.reasons,
    };
    // Plan's keyword refresh target: shorten (never below plan/source floors) so the slowest keyword meets it.
    const rotations = mine.map((q) => q.params?.rotation).filter((r): r is Rotation => Boolean(r));
    const floor = Math.max(planMin, SOURCE_MIN_INTERVAL[s.platform] ?? 0);
    const t = mine.length && !end
      ? applyKeywordTarget({
        platformName: adapters[s.platform].name, interval: decision.interval, rotations, targetMinutes: target,
        floorMinutes: floor, planName, sourceMinMinutes: SOURCE_MIN_INTERVAL[s.platform],
      })
      : null;
    if (t?.shortened) {
      decision.interval = t.interval;
      decision.reasons.push(`Checked every ${formatInterval(t.interval)} so every keyword is searched within the ${planName} plan's ${formatInterval(target)} refresh target`);
    }
    const turns = Math.max(1, ...rotations.map((r) => rotationTurns(r)));
    return { s, p, paid, decision, model, mine, groups, turns, floor, conflict: t?.conflict ?? null, paced: false };
  });

  // Paid-source pacing: the projected spend must fit this product's share of the plan's monthly paid
  // allowance — but never by slowing a search past its brand-safe interval (that would lose mentions).
  const paidDecided = decided.filter((d) => d.paid && d.mine.length && adapters[d.s.platform].configured().ok);
  if (paidDecided.length && Number(c.paid_allowance_usd ?? 0) > 0) {
    const { data: bctx } = await admin.rpc("svc_paid_budget_context", { p_product_id: productId });
    const b = bctx as { allowance_usd: number; spent_usd: number; paid_products: number; month_end: string; prices: Record<string, number> } | null;
    if (b) {
      const remaining = Math.max(0, Number(b.allowance_usd) - Number(b.spent_usd)) / Math.max(1, Number(b.paid_products));
      const minutesLeft = Math.max(60, (new Date(b.month_end).getTime() - now.getTime()) / 60_000);
      const groupsOf = (d: (typeof paidDecided)[number]) => d.mine.map((q, k) => ({
        stream: q.stream, rotation: q.params?.rotation ?? null,
        rateUpperPerHour: upperRate(d.groups[k]!.estimate.raw), learning: d.model.learning,
      }));
      const pacing = paceForBudgetSafely(paidDecided.map((d) => ({
        platform: d.s.platform, interval: d.decision.interval, safeMinutes: d.model.safeMinutes,
        costPerCheckUsd: estimateCheckCostV2(d.s.platform, groupsOf(d), d.decision.interval, b.prices ?? {}),
        costAt: (iv: number) => estimateCheckCostV2(d.s.platform, groupsOf(d), iv, b.prices ?? {}),
      })), remaining, minutesLeft);
      for (const d of paidDecided) {
        const paced = pacing.intervals.get(d.s.platform)!;
        if (pacing.paced.has(d.s.platform) && paced > d.decision.interval) {
          d.decision.interval = paced;
          d.paced = true;
          d.decision.reasons.push(`Checked every ${formatInterval(paced)} so the ${planName} plan's paid-source allowance lasts the whole month`);
          const slowest = paced * d.turns;
          d.conflict = slowest > target
            ? `Keyword refresh target (${formatInterval(target)}) not met on ${adapters[d.s.platform].name}: each keyword is searched every ${formatInterval(slowest)} to stay within the plan's paid-source allowance.`
            : d.conflict;
        }
        if (pacing.blockedBySafety.has(d.s.platform)) {
          d.decision.reasons.push("Not slowed further to save budget: busier checks would let results overflow and be missed");
        }
        if (!pacing.fits) {
          d.decision.reasons.push("The paid-source allowance may run out before the period ends; paid checks beyond it are refused and shown as coverage gaps until it renews");
        }
      }
    }
  }
  if (c.allowance_paused_until) {
    for (const d of decided.filter((x) => x.paid)) {
      d.decision.reasons.push(`Paused: this period's mention allowance is used up (paid platforms resume ${new Date(c.allowance_paused_until).toISOString().slice(0, 10)})`);
    }
  }

  const ranks = rankByImportance(shares, (pl) => decided.some((d) => d.s.platform === pl && !d.model.learning));
  const upserts: Array<Record<string, unknown>> = [];
  const changes: Array<Record<string, unknown>> = [];
  for (const { s, p, decision, model, turns, conflict, paced, mine, floor } of decided) {
    const rank = ranks.get(s.platform) ?? null;
    const slowest = decision.interval * turns;
    const { risk, detail } = assessRisk(decision.interval, model.safeMinutes, floor);
    const share = shares[s.platform] ?? 0;
    out.set(s.platform, {
      platform: s.platform, rank, assessment: s.assessment, decision, n7: s.n7,
      keywordTargetMinutes: target, slowestKeywordMinutes: slowest, keywordConflict: conflict, budgetPaced: paced,
      model, importanceShare: share, risk, riskDetail: detail,
      groupSafeMinutes: new Map(model.groups.map((g) => [g.id, g.safeMinutes])),
    });
    upserts.push({
      product_id: productId, workspace_id: c.workspace_id, platform: s.platform,
      phase: s.assessment.phase, score: Math.round(share * 100), rank,
      components: s.assessment.components, discovery: s.assessment.discovery, mentions_24h: s.row.n24, mentions_7d: s.row.n7,
      baseline_weekly: s.assessment.baselineWeekly, growth_pct: s.assessment.growthPct, trend: s.assessment.trend,
      coverage_confidence: s.assessment.confidence, complete_share: Math.max(0, Math.min(1, Number(s.row.complete_share7))),
      recommended_interval: Math.max(INTERVAL_STEPS[0], Math.min(1440, decision.recommended)), interval_minutes: decision.interval, plan_limited: decision.planLimited,
      lengthen_pending_since: decision.pendingSince?.toISOString() ?? null,
      last_success_at: s.row.last_success_at, next_run_at: s.row.next_run_at,
      reasons: [...s.assessment.notes, ...decision.reasons], computed_at: now.toISOString(),
      keyword_target_minutes: target, slowest_keyword_minutes: mine.length ? slowest : null,
      keyword_conflict: conflict, budget_paced: paced,
      importance_share: Math.max(0, Math.min(1, share)), arrival_per_day: model.arrivalPerDay, rate_upper_per_hour: model.rateUpperPerHour,
      safe_interval_minutes: model.safeMinutes !== null ? Math.max(1, model.safeMinutes) : null,
      collection_risk: risk, risk_detail: detail, uncertainty: model.uncertainty, model: "arrival_v2",
    });
    if (p && p.interval_minutes !== decision.interval) {
      changes.push({
        workspace_id: c.workspace_id, product_id: productId, platform: s.platform,
        from_minutes: p.interval_minutes, to_minutes: decision.interval, score: Math.round(share * 100), reasons: decision.reasons,
      });
    }
  }
  if (upserts.length) {
    const { error: upErr } = await admin.from("platform_activity").upsert(upserts, { onConflict: "product_id,platform" });
    if (upErr) throw new Error(`Couldn't store activity ranking (${upErr.code ?? "db"})`);
  }
  if (changes.length) await admin.from("monitoring_interval_changes").insert(changes);
  await applySchedules(admin, queries, out, opts.exceptQueryId, now);
  return out;
}

/**
 * A search's own interval: the platform interval × its rotation turns, but a
 * rotating search whose results would overflow before its turn comes round
 * gets earlier, out-of-turn checks (never faster than the platform floor).
 */
export function groupIntervalMinutes(d: Pick<PlatformDecision, "decision" | "groupSafeMinutes">, queryId: string, rotation: Rotation | null, floorMinutes: number): { minutes: number; outOfTurn: boolean } {
  const base = keywordIntervalMinutes(d.decision.interval, rotation);
  const safe = d.groupSafeMinutes.get(queryId) ?? null;
  if (!rotation || safe === null || safe >= base) return { minutes: base, outOfTurn: false };
  return { minutes: Math.max(d.decision.interval, floorMinutes, snapDown(safe)), outOfTurn: true };
}

/** Applies platform intervals to their query groups (shorter intervals take effect at once). */
async function applySchedules(
  admin: SupabaseClient, queries: EnabledQuery[], decisions: Map<PublicSourceId, PlatformDecision>, exceptQueryId: string | undefined, now: Date,
) {
  const adapters = getAdapters();
  for (const q of queries) {
    if (!isPublicSource(q.provider) || q.id === exceptQueryId) continue;
    const d = decisions.get(q.provider);
    if (!d) continue;
    const a = adapters[q.provider];
    const runnable = a.configured().ok && !(a.paid && !paidCollectionEnabled());
    let rotation = q.params?.rotation ?? null;
    // A search that takes turns with others refreshes every (platform interval × turns),
    // unless it would overflow before its turn: then it is checked out of turn.
    const g = groupIntervalMinutes(d, q.id, rotation, d.decision.interval);
    const interval = g.minutes;
    const last = date(q.last_success_at);
    let next = new Date(q.next_run_at);
    const reasons = [...d.assessment.notes, ...d.decision.reasons];
    if (rotation && !g.outOfTurn) reasons.push(`Takes turns with ${rotation.rotating - 1} other search${rotation.rotating === 2 ? "" : "es"} (${rotation.slots} per check)`);
    if (g.outOfTurn) {
      reasons.push(`Busy search: checked every ${formatInterval(interval)}, ahead of its turn, so its results don't overflow`);
      rotation = null;
    }
    if (runnable && q.consecutive_failures === 0 && rotation) {
      // New or re-timed rotating search: move to its own time slot so turns stay fair.
      if (q.interval_minutes !== interval || !last) next = rotationNextRun(now, d.decision.interval, rotation);
      if (isOverdue(last, interval, now) && next > now) {
        next = now;
        reasons.push("Catching up on a missed check");
      }
    } else if (runnable && q.consecutive_failures === 0) {
      // Shorter interval: don't wait out the old one. Longer: the next run moves out.
      const byInterval = new Date((last ?? now).getTime() + interval * 60_000);
      if (q.interval_minutes === null || interval < q.interval_minutes) next = byInterval < next ? byInterval : next;
      else if (interval > q.interval_minutes && last) next = byInterval > next ? byInterval : next;
      // Missed-run recovery: nothing succeeded for two intervals (scheduler outage, dead job).
      if (isOverdue(last, interval, now) && next > now) {
        next = now;
        reasons.push("Catching up on a missed check");
      }
    }
    if (q.interval_minutes === interval && next.getTime() === new Date(q.next_run_at).getTime()) continue;
    await admin.from("monitoring_queries").update({
      interval_minutes: interval, next_run_at: next.toISOString(), interval_reasons: reasons, coverage_confidence: d.assessment.confidence,
    }).eq("id", q.id);
  }
}

/** Hourly: re-rank every product with monitoring (time-based slow-downs and boost ends need it). */
export async function refreshActivityForActiveProducts(admin: SupabaseClient, limit = 500): Promise<number> {
  const { data } = await admin.from("monitoring_queries").select("product_id").eq("enabled", true).is("competitor_id", null).limit(10_000);
  const ids = [...new Set((data ?? []).map((r) => r.product_id as string))].slice(0, limit);
  let n = 0;
  for (const id of ids) {
    try {
      await refreshActivity(admin, id);
      n++;
    } catch (e) {
      console.error(`[activity] product ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return n;
}
