import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DAILY_SPIKES, HOURLY_SPIKES, buildSeries, detectSpikes, type Bucket, type CoverageRow, type SeriesRow, type SpikeOptions } from "@/lib/analytics/buzz";

/**
 * Detects spikes for one product from stored mentions + coverage and stores
 * them (idempotent: one row per product/platform/granularity/period). Runs with
 * the service role from the hourly tick. Unmonitored periods are excluded from
 * baselines and never flagged.
 */
export async function detectSpikesForProduct(admin: SupabaseClient, product: { id: string; workspace_id: string }, now = new Date()): Promise<number> {
  let stored = 0;
  const runs: Array<{ bucket: Bucket; opts: SpikeOptions; days: number; recent: number }> = [
    { bucket: "day", opts: DAILY_SPIKES, days: 35, recent: 2 * 86_400_000 },
    { bucket: "hour", opts: HOURLY_SPIKES, days: 8, recent: 6 * 3_600_000 },
  ];
  for (const r of runs) {
    const from = new Date(now.getTime() - r.days * 86_400_000);
    const args = { p_product_id: product.id, p_from: from.toISOString(), p_to: now.toISOString(), p_bucket: r.bucket, p_tz: "UTC", p_sources: null };
    const [{ data: rows, error: e1 }, { data: cov, error: e2 }] = await Promise.all([
      admin.rpc("buzz_series", args),
      admin.rpc("buzz_coverage", args),
    ]);
    if (e1 || e2) throw new Error(`spike inputs failed (${(e1 ?? e2)?.code ?? "db"})`);
    const coverage = (cov ?? []) as CoverageRow[];
    const series = (rows ?? []) as SeriesRow[];
    const sources = [...new Set([...coverage.map((c) => c.source), ...series.map((s) => s.source)].filter((s): s is string => Boolean(s)))];
    const buckets = [...new Set(coverage.map((c) => new Date(c.bucket_start).toISOString()))].sort();
    const points = buildSeries(buckets, sources, series, coverage);
    const step = r.bucket === "day" ? 86_400_000 : 3_600_000;

    const candidates = [
      // Only completely monitored periods count: capped (partial) collection is excluded.
      { platform: null as string | null, pts: points.map((p) => ({ start: p.start, value: p.relevantComplete })) },
      ...sources.map((s) => ({ platform: s, pts: points.map((p) => ({ start: p.start, value: p.bySourceComplete[s] ?? null })) })),
    ];
    for (const c of candidates) {
      // Only recent periods are (re)stored; older ones were evaluated when they were recent.
      const spikes = detectSpikes(c.pts, r.opts).filter((sp) => now.getTime() - new Date(sp.start).getTime() <= r.recent);
      if (spikes.length === 0) continue;
      const { error } = await admin.from("buzz_spikes").upsert(spikes.map((sp) => ({
        workspace_id: product.workspace_id, product_id: product.id, platform: c.platform, granularity: r.bucket,
        period_start: sp.start, period_end: new Date(new Date(sp.start).getTime() + step).toISOString(),
        observed: sp.observed, expected: sp.expected, baseline_periods: sp.baselinePeriods,
        robust_z: sp.robustZ, ratio: sp.ratio, severity: sp.severity, detected_at: now.toISOString(),
      })), { onConflict: "product_id,platform,granularity,period_start" });
      if (!error) stored += spikes.length;
    }
  }
  return stored;
}

/** Products with mentions discovered in the last 2 hours. */
export async function detectSpikesForActiveProducts(admin: SupabaseClient, limit = 200): Promise<number> {
  const since = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const { data } = await admin.from("mentions").select("product_id, workspace_id").gte("discovered_at", since).limit(5000);
  const products = new Map<string, string>();
  for (const r of data ?? []) products.set(r.product_id as string, r.workspace_id as string);
  let n = 0;
  for (const [id, workspace_id] of [...products].slice(0, limit)) {
    try {
      n += await detectSpikesForProduct(admin, { id, workspace_id });
    } catch (e) {
      console.error(`[spikes] ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return n;
}
