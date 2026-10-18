import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { coverageRows, coveredShare, totals } from "@/lib/server/analytics/buzz";
import {
  coverageStatus, keywordPerformance, platformPerformance,
  type CountRow, type CoverageStatus, type KeywordPerformance, type PlatformPerformance,
} from "@/lib/analytics/keyword-ranking";
import type { MonitoringOverview, PlatformMonitoring } from "./monitoring-overview";

/** A platform's previous period counts for growth only if monitoring covered at least half of it. */
const OBSERVED_SHARE = 0.5;

export interface KeywordRankings {
  period: { label: string; from: string; to: string };
  /** Unique relevant mentions on monitored platforms in the period (each mention once). */
  totalMentions: number;
  keywords: KeywordPerformance[];
  platforms: Array<PlatformPerformance & { platform: PlatformMonitoring }>;
  /** True while any monitored platform is not yet fully observed (rankings are "based on observed mentions"). */
  observedOnly: boolean;
}

export function platformStatus(p: PlatformMonitoring): CoverageStatus {
  return coverageStatus({
    // Scanned = a live check succeeded or any coverage window exists (historical search counts too).
    lastScanAt: p.lastScanAt ?? (p.state !== "not_started" ? "covered" : null),
    learning: !p.ranking || p.ranking.phase === "discovery",
    partial: p.state === "partial" || p.state === "failing" || (p.confidence !== null && p.confidence !== "high"),
  });
}

/**
 * Keyword × platform and overall platform rankings for the selected period,
 * from stored mentions only (no API calls). Reads through the caller's RLS.
 */
export async function getKeywordRankings(
  sb: SupabaseClient, productId: string, o: MonitoringOverview, range: { from: Date; to: Date; label: string },
): Promise<KeywordRankings> {
  // The selected reporting period, compared with the period of the same length just before it.
  // The database compares at most 400 days at a time; longer custom ranges use their most recent 400 days.
  const to = range.to;
  const from = new Date(Math.max(range.from.getTime(), to.getTime() - 400 * 86_400_000));
  const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
  const active = o.platforms.filter((p) => p.groups > 0 && p.state !== "not_configured" && p.state !== "not_enabled");
  const ids = active.map((p) => p.id);

  const [cur, prev, curTotals, prevTotals, prevCov] = await Promise.all([
    sb.rpc("keyword_platform_counts", { p_product_id: productId, p_from: from.toISOString(), p_to: to.toISOString() }),
    sb.rpc("keyword_platform_counts", { p_product_id: productId, p_from: prevFrom.toISOString(), p_to: from.toISOString() }),
    totals(sb, productId, from, to, null),
    totals(sb, productId, prevFrom, from, null),
    ids.length ? coverageRows(sb, productId, prevFrom, from, "day", "UTC", ids) : Promise.resolve([]),
  ]);
  if (cur.error || prev.error) throw new Error(`keyword_platform_counts failed (${(cur.error ?? prev.error)!.code ?? "db"})`);

  const observed = new Map(ids.map((id) => [id, coveredShare(prevCov, [id]) >= OBSERVED_SHARE]));
  const status = new Map(active.map((p) => [p.id, platformStatus(p)]));
  const searchable = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const k of o.keywordCoverage) {
    for (const p of k.platforms) if (p.intervalMinutes !== null) searchable.get(p.platform)?.add(k.term.trim().toLowerCase());
  }
  const counts = (rows: unknown) => ((rows ?? []) as CountRow[]).map((r) => ({ ...r, mentions: Number(r.mentions) }));
  const bySource = (t: Awaited<ReturnType<typeof totals>>) =>
    Object.fromEntries(t.bySource.filter((r) => ids.includes(r.source as never)).map((r) => [r.source, Number(r.relevant)]));

  const keywords = keywordPerformance({
    keywords: o.keywordCoverage.map((k) => ({ term: k.term, kind: k.kind, paused: k.paused })),
    platforms: active.map((p) => ({ id: p.id, name: p.name, status: status.get(p.id)!, searchable: searchable.get(p.id)!, previousObserved: observed.get(p.id)! })),
    current: counts(cur.data), previous: counts(prev.data),
  });
  const current = bySource(curTotals);
  const platforms = platformPerformance({
    platforms: active.map((p) => ({ id: p.id, name: p.name, status: status.get(p.id)!, previousObserved: observed.get(p.id)! })),
    current, previous: bySource(prevTotals),
  }).map((r) => ({ ...r, platform: active.find((p) => p.id === r.id)! }));

  return {
    period: { label: range.label, from: from.toISOString(), to: to.toISOString() },
    totalMentions: Object.values(current).reduce((t, n) => t + n, 0),
    keywords,
    platforms,
    observedOnly: [...status.values()].some((s) => s !== "monitored"),
  };
}
