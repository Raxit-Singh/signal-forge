import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checksAvoided, expectedDiscoveryMinutes } from "@/lib/sources/adaptive";
import { planQueries, NON_OR_QUERY_CAP, type MonitoringMode, type SkippedKeyword } from "@/lib/sources/query-optimizer";
import { isLegacySource, PUBLIC_SOURCES, streamsOf } from "@/lib/sources/registry";
import type { PublicSourceId } from "@/lib/sources/types";
import { getCoverageSummary, type CoverageState } from "./status";
import { getAdapters, paidCollectionEnabled } from "./sources";
import { resolveEnablement } from "./query-sync";

export interface PlatformMonitoring {
  id: PublicSourceId;
  name: string;
  paid: boolean;
  state: CoverageState;
  stateDetail?: string;
  /** For sources the product can switch on/off itself. */
  toggle: { enabled: boolean; allowed: boolean; reason?: string } | null;
  groups: number;
  streams: string[];
  intervalMinutes: number | null;
  lastScanAt: string | null;
  nextScanAt: string | null;
  discovery: { typical: number; worst: number } | null;
  confidence: "high" | "medium" | "low" | null;
  reasons: string[];
  mentions7d: number;
  checks7d: number;
  saturatedRecently: boolean;
  failures: number;
  searched: string[];
  skipped: SkippedKeyword[];
}

export interface MonitoringOverview {
  mode: MonitoringMode;
  platforms: PlatformMonitoring[];
  efficiency: {
    checks7d: number;
    hourlyEquivalent: number;
    avoided: number;
    percentFewer: number;
    sharedFetches: number;
    intervalChanges: number;
  };
  paid: { serverEnabled: boolean; includedInPlan: boolean; allowanceUsedPercent: number | null; maxBoostPaidChecks: number; boostMinMinutes: number };
  boosts: Array<{ id: string; title: string; platforms: string[]; mode: string; starts_at: string; ends_at: string; max_paid_checks: number; canceled_at: string | null }>;
}

interface QueryRow {
  id: string;
  provider: string;
  stream: string;
  enabled: boolean;
  last_success_at: string | null;
  next_run_at: string;
  interval_minutes: number | null;
  interval_reasons: string[];
  coverage_confidence: "high" | "medium" | "low" | null;
  consecutive_failures: number;
  last_saturated_at: string | null;
  params: { terms?: string[] };
}

const CONF_RANK = { low: 0, medium: 1, high: 2 } as const;

/**
 * Everything the Smart Monitoring page shows for one product. Reads through
 * RLS; plan entitlements come from the service role and are reduced to
 * yes/no and percentages (supplier prices are never exposed).
 */
export async function getMonitoringOverview(productId: string, workspaceId: string): Promise<MonitoringOverview> {
  const sb = await createClient();
  const admin = createAdminClient();
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);

  const [{ data: product }, { data: queries }, { data: execs }, { data: settings }, { data: boosts }, { data: aliases }, coverage, totalsRes, { data: ctx }, { data: alloc }] = await Promise.all([
    sb.from("products").select("id, website_url, app_store_url, monitoring_mode, archived_at, workspace_id").eq("id", productId).maybeSingle(),
    sb.from("monitoring_queries")
      .select("id, provider, stream, enabled, last_success_at, next_run_at, interval_minutes, interval_reasons, coverage_confidence, consecutive_failures, last_saturated_at, params")
      .eq("product_id", productId).is("competitor_id", null),
    sb.from("monitoring_executions").select("query_id, platform, status, shared_with, next_interval_minutes, finished_at")
      .eq("product_id", productId).gte("finished_at", since7d).order("finished_at").limit(5000),
    sb.from("product_source_settings").select("platform, enabled").eq("product_id", productId),
    sb.from("launch_boosts").select("id, title, platforms, mode, starts_at, ends_at, max_paid_checks, canceled_at")
      .eq("product_id", productId).gte("ends_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("starts_at", { ascending: false }),
    sb.from("product_aliases").select("term, kind, is_ambiguous, context_terms").eq("product_id", productId).eq("enabled", true),
    getCoverageSummary(productId),
    sb.rpc("buzz_totals", { p_product_id: productId, p_from: since7d, p_to: new Date().toISOString() }),
    admin.rpc("svc_schedule_context", { p_product_id: productId, p_platform: "reddit" }),
    admin.from("api_cost_allocations").select("share, api_cost_ledger!inner(status, estimated_usd, charged_usd, period_start)")
      .eq("workspace_id", workspaceId).eq("api_cost_ledger.period_start", monthStart),
  ]);
  if (!product) throw new Error("Product not found");

  const mode = (product.monitoring_mode ?? "balanced") as MonitoringMode;
  const adapters = getAdapters();
  const sc = (ctx ?? {}) as { paid_allowance_usd?: number; boost_min_minutes?: number; max_boost_paid_checks?: number };
  const allowance = Number(sc.paid_allowance_usd ?? 0);
  const settingsMap = new Map((settings ?? []).map((s) => [s.platform as string, s.enabled as boolean]));
  const enablement = new Map(resolveEnablement(adapters, { ...product, monitoring_mode: mode } as never, settingsMap, allowance, paidCollectionEnabled()).map((e) => [e.id, e]));
  const coverageBy = new Map(coverage.sources.map((s) => [s.id, s]));
  const mentions7d = new Map(((totalsRes.data ?? []) as Array<{ source: string; relevant: number }>).map((r) => [r.source, Number(r.relevant)]));
  const keywords = (aliases ?? []).map((a) => ({ term: a.term, kind: a.kind, isAmbiguous: a.is_ambiguous, contextTerms: a.context_terms ?? [] }));

  const qs = (queries ?? []) as QueryRow[];
  const ex = execs ?? [];
  const platforms: PlatformMonitoring[] = PUBLIC_SOURCES.map((id) => {
    const a = adapters[id];
    const cov = coverageBy.get(id);
    const mine = qs.filter((q) => q.provider === id && q.enabled);
    const intervals = mine.map((q) => q.interval_minutes).filter((x): x is number => typeof x === "number");
    const interval = intervals.length ? Math.min(...intervals) : null;
    const fastest = mine.find((q) => q.interval_minutes === interval) ?? mine[0];
    const confs = mine.map((q) => q.coverage_confidence).filter((c): c is "high" | "medium" | "low" => Boolean(c));
    const lastScans = mine.map((q) => q.last_success_at).filter(Boolean) as string[];
    const nexts = mine.map((q) => q.next_run_at).filter(Boolean);
    const e = enablement.get(id);
    const toggle = isLegacySource(id) ? null : {
      enabled: Boolean(e?.enabled) || settingsMap.get(id) === true,
      allowed: !e?.reason || e.enabled || /Off — turn it on|Turned off/.test(e.reason),
      reason: e?.enabled ? undefined : e?.reason,
    };
    // Explain which keywords each stream searches and which it skips (same optimizer as the worker).
    const searched = new Set<string>();
    const skipped: SkippedKeyword[] = [];
    if (mine.length && keywords.length) {
      for (const s of streamsOf(a)) {
        if (s.queryMode !== "keywords") continue;
        const plan = planQueries(keywords, s.capabilities, a.paid ? NON_OR_QUERY_CAP[mode] : isLegacySource(id) ? null : 5);
        plan.groups.forEach((g) => g.terms.forEach((t) => searched.add(t)));
        for (const k of plan.skipped) if (!skipped.some((x) => x.term === k.term)) skipped.push(k);
      }
    }
    if (isLegacySource(id)) for (const q of mine) (q.params?.terms ?? []).forEach((t) => searched.add(t));
    return {
      id, name: a.name, paid: Boolean(a.paid),
      state: cov?.state ?? "not_started", stateDetail: cov?.detail,
      toggle,
      groups: mine.length,
      streams: [...new Set(mine.map((q) => q.stream))],
      intervalMinutes: interval,
      lastScanAt: lastScans.sort().at(-1) ?? null,
      nextScanAt: nexts.sort()[0] ?? null,
      discovery: interval ? expectedDiscoveryMinutes(interval) : null,
      confidence: confs.length ? confs.reduce((w, c) => (CONF_RANK[c] < CONF_RANK[w] ? c : w)) : null,
      reasons: fastest?.interval_reasons ?? [],
      mentions7d: mentions7d.get(id) ?? 0,
      checks7d: ex.filter((x) => x.platform === id && x.status !== "skipped").length,
      saturatedRecently: mine.some((q) => q.last_saturated_at && Date.now() - new Date(q.last_saturated_at).getTime() < 3 * 86_400_000),
      failures: Math.max(0, ...mine.map((q) => q.consecutive_failures)),
      searched: [...searched],
      skipped,
    };
  });

  // Efficiency over the last 7 days vs. checking every enabled group every hour.
  const activeGroups = qs.filter((q) => q.enabled).length;
  const realChecks = ex.filter((x) => x.status !== "skipped" && x.status !== "covered_by_shared").length;
  const eff = checksAvoided(realChecks, activeGroups, 168);
  let intervalChanges = 0;
  const lastByQuery = new Map<string, number | null>();
  for (const x of ex) {
    if (!x.query_id || x.next_interval_minutes == null) continue;
    const prev = lastByQuery.get(x.query_id);
    if (prev !== undefined && prev !== x.next_interval_minutes) intervalChanges++;
    lastByQuery.set(x.query_id, x.next_interval_minutes);
  }

  // Allowance use as a percentage only.
  let spent = 0;
  for (const r of (alloc ?? []) as unknown as Array<{ share: number; api_cost_ledger: { status: string; estimated_usd: number; charged_usd: number | null } }>) {
    const l = r.api_cost_ledger;
    const amount = l.status === "released" ? 0 : l.status === "settled" ? Number(l.charged_usd ?? l.estimated_usd) : Number(l.estimated_usd);
    spent += amount * Number(r.share);
  }

  return {
    mode,
    platforms,
    efficiency: {
      checks7d: realChecks, hourlyEquivalent: eff.hourly, avoided: eff.avoided, percentFewer: eff.percentFewer,
      sharedFetches: ex.filter((x) => x.status === "covered_by_shared" || (x.shared_with ?? 1) > 1).length,
      intervalChanges,
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
