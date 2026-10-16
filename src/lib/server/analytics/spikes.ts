import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSeries, type Bucket, type CoverageRow, type SeriesRow } from "@/lib/analytics/buzz";
import {
  DAILY_V2, evaluateSpikes, HOURLY_V2, productSpikePoint,
  type SpikeConfigV2, type SpikeEvaluation, type SpikeSeriesPoint, type SpikeV2,
} from "@/lib/analytics/spikes-v2";
import { INHERENTLY_PARTIAL } from "@/lib/sources/collection-profile";
import { emitEvent } from "@/lib/server/collection/monitor";

const DAY = 86_400_000;
/** Daily evaluation reaches back over the whole searched history (bounded); hourly over two weeks. */
const MAX_DAILY_DAYS = 400;
const HOURLY_DAYS = 14;

interface Run {
  bucket: Bucket;
  cfg: SpikeConfigV2;
  from: Date;
  step: number;
}

/**
 * Detects spikes for one product at product, platform and keyword level from
 * stored mentions + coverage, and stores them (service role). Every evaluated
 * period is re-judged on each run — so periods filled in later by a historical
 * search are evaluated too — and stale rows in the evaluated range are replaced.
 */
export async function detectSpikesForProduct(
  admin: SupabaseClient, product: { id: string; workspace_id: string }, now = new Date(),
): Promise<{ stored: number; confirmed: number }> {
  const { data: p } = await admin.from("products").select("history_start, created_at").eq("id", product.id).maybeSingle();
  const historyStart = new Date((p?.history_start as string | null) ?? (p?.created_at as string | null) ?? now.toISOString());
  const dailyFrom = new Date(Math.max(now.getTime() - MAX_DAILY_DAYS * DAY, Math.min(historyStart.getTime(), now.getTime() - 35 * DAY)));
  const runs: Run[] = [
    { bucket: "day", cfg: DAILY_V2, from: new Date(Math.floor(dailyFrom.getTime() / DAY) * DAY), step: DAY },
    { bucket: "hour", cfg: HOURLY_V2, from: new Date(now.getTime() - HOURLY_DAYS * DAY), step: 3_600_000 },
  ];
  let stored = 0;
  let confirmed = 0;
  for (const r of runs) {
    const args = { p_product_id: product.id, p_from: r.from.toISOString(), p_to: now.toISOString(), p_bucket: r.bucket, p_tz: "UTC", p_sources: null };
    const [{ data: rows, error: e1 }, { data: cov, error: e2 }, { data: kw, error: e3 }] = await Promise.all([
      admin.rpc("buzz_series", args),
      admin.rpc("buzz_coverage", args),
      admin.rpc("keyword_series", { p_product_id: product.id, p_from: args.p_from, p_to: args.p_to, p_bucket: r.bucket, p_tz: "UTC" }),
    ]);
    if (e1 || e2 || e3) throw new Error(`spike inputs failed (${(e1 ?? e2 ?? e3)?.code ?? "db"})`);
    const coverage = (cov ?? []) as CoverageRow[];
    const series = (rows ?? []) as SeriesRow[];
    const sources = [...new Set([...coverage.map((c) => c.source), ...series.map((s) => s.source)].filter((s): s is string => Boolean(s)))];
    const buckets = [...new Set(coverage.map((c) => new Date(c.bucket_start).toISOString()))].sort();
    // The current period is still in progress: it is judged (as a lower bound) but never complete.
    const current = new Date(Math.floor(now.getTime() / r.step) * r.step).toISOString();
    const points = buildSeries(buckets, sources, series, coverage);
    const productSeries: SpikeSeriesPoint[] = points.map((pt) => productSpikePoint(pt, sources, INHERENTLY_PARTIAL, current));
    const scopes: Array<{ scope: "product" | "platform"; key: string; platform: string | null; pts: SpikeSeriesPoint[] }> = [
      { scope: "product", key: "", platform: null, pts: productSeries },
      ...sources.map((s) => ({
        scope: "platform" as const, key: s, platform: s,
        pts: points.map((pt) => ({ start: pt.start, value: pt.bySource[s] ?? null, complete: pt.bySourceComplete[s] != null && pt.start !== current })),
      })),
    ];
    const evaluations: Array<{ scope: string; key: string; ev: SpikeEvaluation }> = [];
    const platformRows: Array<Record<string, unknown>> = [];
    for (const s of scopes) {
      const ev = evaluateSpikes(s.pts, r.cfg);
      evaluations.push({ scope: s.scope, key: s.key, ev });
      for (const sp of ev.spikes) platformRows.push(spikeRow(product, r, sp, { platform: s.platform }));
    }

    // Keyword level: counts across every platform; a period is complete when the product series is.
    const completeAt = new Map(productSeries.map((pt) => [pt.start, pt.complete]));
    const measuredAt = new Map(productSeries.map((pt) => [pt.start, pt.value !== null]));
    const byKeyword = new Map<string, Map<string, number>>();
    for (const row of (kw ?? []) as Array<{ bucket_start: string; keyword: string; relevant: number }>) {
      const k = row.keyword;
      if (!byKeyword.has(k)) byKeyword.set(k, new Map());
      byKeyword.get(k)!.set(new Date(row.bucket_start).toISOString(), row.relevant);
    }
    const keywordRows: Array<Record<string, unknown>> = [];
    for (const [k, counts] of byKeyword) {
      const pts = productSeries.map((pt) => ({
        start: pt.start, value: measuredAt.get(pt.start) ? counts.get(pt.start) ?? 0 : null, complete: Boolean(completeAt.get(pt.start)),
      }));
      const ev = evaluateSpikes(pts, r.cfg);
      evaluations.push({ scope: "keyword", key: k.slice(0, 200), ev });
      for (const sp of ev.spikes) keywordRows.push({ ...spikeRow(product, r, sp, {}), keyword: k.slice(0, 200) });
    }

    // Replace the evaluated range (idempotent; periods re-judged with fuller data may change).
    const fromIso = r.from.toISOString();
    const del1 = await admin.from("buzz_spikes").delete().eq("product_id", product.id).eq("granularity", r.bucket).gte("period_start", fromIso);
    const del2 = await admin.from("buzz_keyword_spikes").delete().eq("product_id", product.id).eq("granularity", r.bucket).gte("period_start", fromIso);
    if (del1.error || del2.error) throw new Error(`spike replace failed (${(del1.error ?? del2.error)?.code ?? "db"})`);
    if (platformRows.length) {
      const { error } = await admin.from("buzz_spikes").insert(platformRows);
      if (error) throw new Error(`spikes not stored (${error.code ?? "db"})`);
    }
    if (keywordRows.length) {
      const { error } = await admin.from("buzz_keyword_spikes").insert(keywordRows);
      if (error) throw new Error(`keyword spikes not stored (${error.code ?? "db"})`);
    }
    const { error: evErr } = await admin.from("spike_evaluations").upsert(evaluations.map((e) => ({
      product_id: product.id, workspace_id: product.workspace_id, scope: e.scope, scope_key: e.key, granularity: r.bucket,
      status: e.ev.status, baseline_periods: e.ev.baselinePeriods, needed_periods: e.ev.neededPeriods, evaluated_at: now.toISOString(),
    })), { onConflict: "product_id,scope,scope_key,granularity" });
    if (evErr) throw new Error(`spike evaluations not stored (${evErr.code ?? "db"})`);
    stored += platformRows.length + keywordRows.length;
    confirmed += [...platformRows, ...keywordRows].filter((x) => x.confidence === "confirmed").length;
  }
  return { stored, confirmed };
}

function spikeRow(product: { id: string; workspace_id: string }, r: Run, sp: SpikeV2, extra: { platform?: string | null }) {
  return {
    workspace_id: product.workspace_id, product_id: product.id, ...("platform" in extra ? { platform: extra.platform } : {}),
    granularity: r.bucket, period_start: sp.start, period_end: new Date(new Date(sp.start).getTime() + r.step).toISOString(),
    observed: sp.observed, expected: sp.expected, baseline_periods: sp.baselinePeriods,
    robust_z: Math.max(-9_999_999, Math.min(9_999_999, sp.robustZ)), ratio: Math.min(9_999_999, sp.ratio), p_value: sp.pValue,
    severity: sp.severity, confidence: sp.confidence, note: sp.note, detected_at: new Date().toISOString(),
  };
}

/** Products with new mentions or historical-search progress in the last 2 hours, plus any not evaluated for a day. */
export async function detectSpikesForActiveProducts(admin: SupabaseClient, limit = 200): Promise<number> {
  const since = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [{ data: m }, { data: bf }, { data: monitored }, { data: fresh }] = await Promise.all([
    admin.from("mentions").select("product_id, workspace_id").gte("discovered_at", since).limit(5000),
    admin.from("backfill_tasks").select("product_id, workspace_id").gte("updated_at", since).limit(1000),
    admin.from("monitoring_queries").select("product_id, workspace_id").eq("enabled", true).is("competitor_id", null).limit(10_000),
    admin.from("spike_evaluations").select("product_id").eq("scope", "product").gte("evaluated_at", dayAgo).limit(10_000),
  ]);
  const products = new Map<string, string>();
  for (const r of [...(m ?? []), ...(bf ?? [])]) products.set(r.product_id as string, r.workspace_id as string);
  // Also every monitored product not evaluated in the last day (periods age, baselines change).
  const recent = new Set((fresh ?? []).map((r) => r.product_id as string));
  for (const r of monitored ?? []) if (!recent.has(r.product_id as string)) products.set(r.product_id as string, r.workspace_id as string);
  let n = 0;
  for (const [id, workspace_id] of [...products].slice(0, limit)) {
    try {
      const res = await detectSpikesForProduct(admin, { id, workspace_id });
      n += res.stored;
      if (res.stored > 0) await emitEvent(admin, workspace_id, id, "spikes", { stored: res.stored, confirmed: res.confirmed });
    } catch (e) {
      console.error(`[spikes] ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return n;
}
