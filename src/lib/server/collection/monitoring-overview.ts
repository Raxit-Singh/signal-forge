import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { expectedDiscoveryMinutes, monitoringEfficiency, type ActivityAssessment, type Efficiency, type ScoreComponent, type Trend } from "@/lib/sources/adaptive";
import { explainInterval, explainRank } from "@/lib/sources/explain";
import { keywordIntervalMinutes, planPlatformKeywords, type KeywordStatus, type PlatformKeywordPlan } from "@/lib/sources/keyword-plan";
import { devMonitoringFloor } from "@/lib/domain/dev-entitlement";
import { serverEnv } from "@/lib/server/env";
import type { SkippedKeyword } from "@/lib/sources/query-optimizer";
import { isLegacySource, PUBLIC_SOURCES } from "@/lib/sources/registry";
import type { PublicSourceId } from "@/lib/sources/types";
import { getCoverageSummary, type CoverageState } from "./status";
import { getAdapters, paidCollectionEnabled } from "./sources";
import { keywordAllowanceFor, resolveEnablement } from "./query-sync";
import { applyKeywordAllowance } from "@/lib/sources/entitlements";

export interface PlatformMonitoring {
  id: PublicSourceId;
  name: string;
  paid: boolean;
  state: CoverageState;
  stateDetail?: string;
  /** For sources the product can switch on/off itself. */
  toggle: { enabled: boolean; allowed: boolean; reason?: string } | null;
  /** Enabled query groups (= searches per check). */
  groups: number;
  /** Ranking (null until the platform has been scored). */
  ranking: {
    phase: "discovery" | "ranked";
    rank: number | null;
    score: number | null;
    components: ScoreComponent[];
    trend: Trend;
    growthPct: number | null;
    baselineWeekly: number | null;
    recommendedMinutes: number;
    planLimited: boolean;
    computedAt: string;
    rankText: string;
    intervalText: string;
    /** V2: share of this product's relevant mentions (0..1), relevant/day, brand-safe bound and overflow risk. */
    importanceShare: number | null;
    arrivalPerDay: number | null;
    safeMinutes: number | null;
    risk: "none" | "watch" | "at_risk" | "unavoidable" | null;
    riskDetail: string | null;
  } | null;
  mentions7d: number;
  intervalMinutes: number | null;
  lastScanAt: string | null;
  nextScanAt: string | null;
  discovery: { typical: number; worst: number } | null;
  confidence: "high" | "medium" | "low" | null;
  completeShare: number | null;
  reasons: string[];
  checks7d: number;
  saturatedRecently: boolean;
  failures: number;
  keywords: { searched: string[]; searches: number; searchesPerCheck: number; rotating: number; combined: boolean; skipped: SkippedKeyword[]; productOnly: boolean };
  /** Slowest keyword's effective interval on this platform, and why the plan's target isn't met (if it isn't). */
  slowestKeywordMinutes: number | null;
  /** Effective keyword refresh range from the scheduled searches (platform interval × rotation turns). */
  keywordIntervals: { min: number; max: number } | null;
  keywordConflict: string | null;
  budgetPaced: boolean;
}

export interface KeywordPlatformCoverage {
  platform: PublicSourceId;
  name: string;
  status: KeywordStatus;
  detail: string;
  /** Effective refresh interval of the search that finds this keyword (null = not searched). */
  intervalMinutes: number | null;
  /** True when it comes from the scheduled search itself; false = computed (not scheduled yet). */
  scheduled: boolean;
  via?: string;
}

export interface KeywordCoverageRow {
  term: string;
  kind: string;
  /** Over the plan's keyword allowance (e.g. after a downgrade): kept, not searched. */
  paused: boolean;
  platforms: KeywordPlatformCoverage[];
}

export interface MonitoringOverview {
  plan: {
    name: string; minIntervalMinutes: number; devFloorMinutes: number | null;
    keywordTargetMinutes: number; maxKeywords: number; keywordAllowance: number;
  };
  /** Paid platforms paused because the month's mention allowance is used up (until this time). */
  allowancePausedUntil: string | null;
  keywordCoverage: KeywordCoverageRow[];
  platforms: PlatformMonitoring[];
  summary: {
    activePlatforms: number;
    efficiency: Efficiency;
    avgDiscoveryMinutes: number | null;
    intervalChanges7d: number;
    incompleteCoverage: number;
    sharedFetches: number;
  };
  paid: { serverEnabled: boolean; includedInPlan: boolean; allowanceUsedPercent: number | null; maxBoostPaidChecks: number; boostMinMinutes: number };
  boosts: Array<{ id: string; title: string; platforms: string[]; starts_at: string; ends_at: string; max_paid_checks: number; canceled_at: string | null }>;
}

interface QueryRow {
  id: string;
  provider: string;
  params: { terms?: string[]; rotation?: unknown } | null;
  enabled: boolean;
  last_success_at: string | null;
  next_run_at: string;
  interval_minutes: number | null;
  interval_reasons: string[];
  coverage_confidence: "high" | "medium" | "low" | null;
  consecutive_failures: number;
  last_saturated_at: string | null;
}

interface ActivityRow {
  platform: string;
  phase: "discovery" | "ranked";
  score: number | null;
  rank: number | null;
  components: ScoreComponent[];
  discovery: ActivityAssessment["discovery"];
  mentions_7d: number;
  baseline_weekly: number | null;
  growth_pct: number | null;
  trend: Trend;
  coverage_confidence: "high" | "medium" | "low";
  complete_share: number;
  recommended_interval: number;
  interval_minutes: number;
  plan_limited: boolean;
  reasons: string[];
  computed_at: string;
  slowest_keyword_minutes: number | null;
  keyword_conflict: string | null;
  budget_paced: boolean;
  importance_share: number | null;
  arrival_per_day: number | null;
  safe_interval_minutes: number | null;
  collection_risk: "none" | "watch" | "at_risk" | "unavoidable" | null;
  risk_detail: string | null;
  model: "score_v1" | "arrival_v2";
}

const CONF_RANK = { low: 0, medium: 1, high: 2 } as const;
const WEEK_MS = 7 * 86_400_000;

/** Rebuilds just enough of an assessment from a stored row to explain it. */
function storedAssessment(r: ActivityRow, saturatedRecently: boolean): ActivityAssessment {
  return {
    phase: r.phase, score: r.score ?? 0, components: r.components ?? [], baselineWeekly: r.baseline_weekly === null ? null : Number(r.baseline_weekly),
    growthPct: r.growth_pct === null ? null : Number(r.growth_pct), trend: r.trend, confidence: r.coverage_confidence,
    spikeRecent: (r.components ?? []).some((c) => c.id === "spikes" && c.value === 1),
    saturatedRecently, auditMissed: 0,
    discovery: r.phase === "discovery" ? r.discovery : null,
    notes: [],
  };
}

/**
 * Everything the Smart Monitoring page shows for one product. Reads through
 * RLS; plan entitlements come from the service role and are reduced to plan
 * names, intervals and percentages (supplier prices are never exposed).
 */
export async function getMonitoringOverview(productId: string, workspaceId: string): Promise<MonitoringOverview> {
  const sb = await createClient();
  const admin = createAdminClient();
  const nowMs = Date.now();
  const since7d = new Date(nowMs - WEEK_MS).toISOString();
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);

  const [{ data: product }, { data: queries }, { data: execs }, { data: settings }, { data: boosts }, { data: aliases }, coverage, { data: activity }, { data: changes }, { data: ctx }, { data: alloc }] = await Promise.all([
    sb.from("products").select("id, website_url, app_store_url, archived_at, workspace_id").eq("id", productId).maybeSingle(),
    sb.from("monitoring_queries")
      .select("id, provider, params, enabled, last_success_at, next_run_at, interval_minutes, interval_reasons, coverage_confidence, consecutive_failures, last_saturated_at")
      .eq("product_id", productId).is("competitor_id", null),
    sb.from("monitoring_executions").select("query_id, platform, status, shared_with, finished_at")
      .eq("product_id", productId).gte("finished_at", since7d).order("finished_at").limit(5000),
    sb.from("product_source_settings").select("platform, enabled").eq("product_id", productId),
    sb.from("launch_boosts").select("id, title, platforms, starts_at, ends_at, max_paid_checks, canceled_at")
      .eq("product_id", productId).gte("ends_at", since7d).order("starts_at", { ascending: false }),
    sb.from("product_aliases").select("term, kind, is_ambiguous, context_terms").eq("product_id", productId).eq("enabled", true),
    getCoverageSummary(productId),
    sb.from("platform_activity")
      .select("platform, phase, score, rank, components, discovery, mentions_7d, baseline_weekly, growth_pct, trend, coverage_confidence, complete_share, recommended_interval, interval_minutes, plan_limited, reasons, computed_at, slowest_keyword_minutes, keyword_conflict, budget_paced, importance_share, arrival_per_day, safe_interval_minutes, collection_risk, risk_detail, model")
      .eq("product_id", productId),
    sb.from("monitoring_interval_changes").select("id").eq("product_id", productId).gte("created_at", since7d).limit(1000),
    admin.rpc("svc_schedule_context", { p_product_id: productId, p_platform: "reddit" }),
    admin.from("api_cost_allocations").select("share, api_cost_ledger!inner(status, estimated_usd, charged_usd, period_start)")
      .eq("workspace_id", workspaceId).eq("api_cost_ledger.period_start", monthStart),
  ]);
  if (!product) throw new Error("Product not found");

  const adapters = getAdapters();
  const sc = (ctx ?? {}) as {
    plan_name?: string; plan_min_minutes?: number; paid_allowance_usd?: number; boost_min_minutes?: number;
    max_boost_paid_checks?: number; max_searches_per_platform?: number; max_keywords?: number; keyword_target_minutes?: number;
    allowance_paused_until?: string | null;
  };
  const allowance = Number(sc.paid_allowance_usd ?? 0);
  const budget = { planMaxSearches: Number(sc.max_searches_per_platform ?? 2), stackExchangeKey: Boolean(serverEnv().STACKEXCHANGE_KEY) };
  const devFloor = devMonitoringFloor(process.env, workspaceId);
  const plans = new Map<PublicSourceId, PlatformKeywordPlan>();
  const planName = sc.plan_name ?? "current";
  const settingsMap = new Map((settings ?? []).map((s) => [s.platform as string, s.enabled as boolean]));
  const enablement = new Map(resolveEnablement(adapters, product as never, settingsMap, allowance, paidCollectionEnabled()).map((e) => [e.id, e]));
  const coverageBy = new Map(coverage.sources.map((s) => [s.id, s]));
  const activityBy = new Map(((activity ?? []) as ActivityRow[]).map((r) => [r.platform, r]));
  const allKeywords = (aliases ?? []).map((a) => ({ term: a.term, kind: a.kind, isAmbiguous: a.is_ambiguous, contextTerms: a.context_terms ?? [] }));
  const maxKeywords = Number(sc.max_keywords ?? 10);
  const keywordAllowance = await keywordAllowanceFor(sb, productId, workspaceId, maxKeywords);
  const { active: keywords, paused: pausedKeywords } = applyKeywordAllowance(allKeywords, keywordAllowance);
  const activeBoost = new Set(
    (boosts ?? []).filter((b) => !b.canceled_at && new Date(b.starts_at).getTime() <= nowMs && new Date(b.ends_at).getTime() > nowMs)
      .flatMap((b) => b.platforms as string[]),
  );
  const ranked = [...activityBy.values()].filter((r) => r.phase === "ranked");
  const maxMentions = Math.max(0, ...ranked.map((r) => r.mentions_7d));

  const qs = (queries ?? []) as QueryRow[];
  const ex = execs ?? [];
  const platforms: PlatformMonitoring[] = PUBLIC_SOURCES.map((id) => {
    const a = adapters[id];
    const cov = coverageBy.get(id);
    const mine = qs.filter((q) => q.provider === id && q.enabled);
    const act = activityBy.get(id);
    const intervals = mine.map((q) => q.interval_minutes).filter((x): x is number => typeof x === "number");
    const interval = act?.interval_minutes ?? (intervals.length ? Math.min(...intervals) : null);
    const fastest = mine.find((q) => q.interval_minutes === interval) ?? mine[0];
    const confs = mine.map((q) => q.coverage_confidence).filter((c): c is "high" | "medium" | "low" => Boolean(c));
    const lastScans = mine.map((q) => q.last_success_at).filter(Boolean) as string[];
    const nexts = mine.map((q) => q.next_run_at).filter(Boolean);
    const saturatedRecently = mine.some((q) => q.last_saturated_at && nowMs - new Date(q.last_saturated_at).getTime() < 3 * 86_400_000);
    const e = enablement.get(id);
    const toggle = isLegacySource(id) ? null : {
      enabled: Boolean(e?.enabled) || settingsMap.get(id) === true,
      allowed: !e?.reason || e.enabled || /Off — turn it on|Turned off/.test(e.reason),
      reason: e?.enabled ? undefined : e?.reason,
    };
    const kp = keywords.length || streamsAreProductOnly(id) ? planPlatformKeywords(id, a, keywords, budget) : null;
    if (kp) plans.set(id, kp);
    let ranking: PlatformMonitoring["ranking"] = null;
    if (act) {
      const assessment = storedAssessment(act, saturatedRecently);
      const ex2 = {
        name: a.name, rank: act.rank, assessment, n7: act.mentions_7d, mostMentions: act.mentions_7d === maxMentions,
        interval: act.interval_minutes, recommended: act.recommended_interval, planLimited: act.plan_limited, planName, boosted: activeBoost.has(id),
        v2: act.model === "arrival_v2" && act.importance_share !== null
          ? { share: Number(act.importance_share), arrivalPerDay: Number(act.arrival_per_day ?? 0), safeMinutes: act.safe_interval_minutes, risk: act.collection_risk }
          : undefined,
      };
      ranking = {
        phase: act.phase, rank: act.rank, score: act.score, components: act.components ?? [], trend: act.trend,
        growthPct: assessment.growthPct, baselineWeekly: assessment.baselineWeekly,
        recommendedMinutes: act.recommended_interval, planLimited: act.plan_limited, computedAt: act.computed_at,
        rankText: explainRank(ex2), intervalText: explainInterval(ex2),
        importanceShare: act.importance_share === null ? null : Number(act.importance_share),
        arrivalPerDay: act.arrival_per_day === null ? null : Number(act.arrival_per_day),
        safeMinutes: act.safe_interval_minutes, risk: act.collection_risk, riskDetail: act.risk_detail,
      };
    }
    return {
      id, name: a.name, paid: Boolean(a.paid),
      state: cov?.state ?? "not_started", stateDetail: cov?.detail,
      toggle,
      groups: mine.length,
      ranking,
      mentions7d: act?.mentions_7d ?? 0,
      intervalMinutes: interval,
      lastScanAt: lastScans.sort().at(-1) ?? null,
      nextScanAt: nexts.sort()[0] ?? null,
      discovery: interval ? expectedDiscoveryMinutes(interval) : null,
      confidence: act?.coverage_confidence ?? (confs.length ? confs.reduce((w, c) => (CONF_RANK[c] < CONF_RANK[w] ? c : w)) : null),
      completeShare: act ? Number(act.complete_share) : null,
      reasons: act?.reasons ?? fastest?.interval_reasons ?? [],
      checks7d: ex.filter((x) => x.platform === id && x.status !== "skipped" && x.status !== "covered_by_shared").length,
      saturatedRecently,
      failures: Math.max(0, ...mine.map((q) => q.consecutive_failures)),
      keywords: {
        searched: kp?.searched ?? [],
        searches: mine.length,
        searchesPerCheck: kp?.searchesPerCheck ?? mine.length,
        rotating: kp?.keywords.filter((k) => k.status === "rotating").length ?? 0,
        combined: Boolean(kp && kp.booleanOr && kp.searched.length > mine.length),
        skipped: kp?.skipped ?? [],
        productOnly: Boolean(kp?.productOnly),
      },
      slowestKeywordMinutes: act?.slowest_keyword_minutes ?? null,
      keywordIntervals: (() => {
        const xs = mine.map((q) => q.interval_minutes).filter((x): x is number => typeof x === "number");
        return xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : null;
      })(),
      keywordConflict: act?.keyword_conflict ?? null,
      budgetPaced: Boolean(act?.budget_paced),
    };
  });

  // Efficiency over the last 7 days, only for groups that actually ran on platforms that can run,
  // and only over the hours since each group's first check in the window (no credit for time off).
  const runnable = new Set(platforms.filter((p) => p.groups > 0 && p.state !== "not_configured" && p.state !== "not_enabled").map((p) => p.id));
  const byQuery = new Map<string, { first: number; checks: number }>();
  for (const x of ex) {
    if (!x.query_id || !runnable.has(x.platform as PublicSourceId) || x.status === "skipped") continue;
    const cur = byQuery.get(x.query_id) ?? { first: new Date(x.finished_at).getTime(), checks: 0 };
    if (x.status !== "covered_by_shared") cur.checks++;
    byQuery.set(x.query_id, cur);
  }
  const enabledIds = new Set(qs.filter((q) => q.enabled).map((q) => q.id));
  const efficiency = monitoringEfficiency(
    [...byQuery].filter(([id]) => enabledIds.has(id)).map(([, v]) => ({ observedHours: (nowMs - v.first) / 3_600_000, checks: v.checks })),
  );

  const active = platforms.filter((p) => runnable.has(p.id));
  const delays = active.map((p) => p.discovery?.typical).filter((x): x is number => typeof x === "number");

  // Allowance use as a percentage only.
  let spent = 0;
  for (const r of (alloc ?? []) as unknown as Array<{ share: number; api_cost_ledger: { status: string; estimated_usd: number; charged_usd: number | null } }>) {
    const l = r.api_cost_ledger;
    const amount = l.status === "released" ? 0 : l.status === "settled" ? Number(l.charged_usd ?? l.estimated_usd) : Number(l.estimated_usd);
    spent += amount * Number(r.share);
  }

  // Keyword × platform coverage on the platforms that actually run.
  const planFloor = Math.min(Number(sc.plan_min_minutes ?? 1440), devFloor ?? Number.POSITIVE_INFINITY);
  const keywordCoverage: KeywordCoverageRow[] = [...keywords.map((k) => ({
    term: k.term,
    kind: k.kind,
    paused: false,
    platforms: active.flatMap((p): KeywordPlatformCoverage[] => {
      const term = k.term.replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
      const c = plans.get(p.id)?.keywords.find((x) => x.term === term);
      if (!c || c.status === "not_applicable") return [];
      const searched = c.status === "every_check" || c.status === "rotating" || c.status === "covered" || c.status === "duplicate";
      // The actual schedule: the enabled search(es) that carry this keyword (or the keyword that covers it).
      const clean = (t: string) => t.replace(/["()]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      const want = clean(c.via ?? term);
      const stored = qs.filter((q) => q.enabled && q.provider === p.id && (q.params?.terms ?? []).some((t) => clean(t) === want))
        .map((q) => q.interval_minutes).filter((x): x is number => typeof x === "number");
      return [{
        platform: p.id, name: p.name, status: c.status, detail: c.detail, via: c.via,
        // Scheduled: the search's own interval (platform interval × rotation turns). Not scheduled yet: computed from the plan floor.
        intervalMinutes: !searched ? null : stored.length ? Math.min(...stored) : keywordIntervalMinutes(p.intervalMinutes ?? planFloor, c.rotation),
        scheduled: searched && stored.length > 0,
      }];
    }),
  })), ...pausedKeywords.map((k) => ({ term: k.term, kind: k.kind, paused: true, platforms: [] }))];

  return {
    plan: {
      name: planName, minIntervalMinutes: Number(sc.plan_min_minutes ?? 1440), devFloorMinutes: devFloor,
      keywordTargetMinutes: Number(sc.keyword_target_minutes ?? 10080), maxKeywords, keywordAllowance,
    },
    allowancePausedUntil: sc.allowance_paused_until ?? null,
    keywordCoverage,
    platforms,
    summary: {
      activePlatforms: active.length,
      efficiency,
      avgDiscoveryMinutes: delays.length ? Math.round(delays.reduce((t, d) => t + d, 0) / delays.length) : null,
      intervalChanges7d: (changes ?? []).length,
      incompleteCoverage: active.filter((p) => p.confidence !== "high").length,
      sharedFetches: ex.filter((x) => x.status === "covered_by_shared" || (x.shared_with ?? 1) > 1).length,
    },
    paid: {
      serverEnabled: paidCollectionEnabled(),
      includedInPlan: allowance > 0,
      allowanceUsedPercent: allowance > 0 ? Math.min(100, Math.round((spent / allowance) * 100)) : null,
      maxBoostPaidChecks: Number(sc.max_boost_paid_checks ?? 0),
      boostMinMinutes: Number(sc.boost_min_minutes ?? 60),
    },
    boosts: (boosts ?? []) as MonitoringOverview["boosts"],
  };
}

function streamsAreProductOnly(id: PublicSourceId) {
  return id === "trustpilot" || id === "app_store";
}
