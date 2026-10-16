import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSeries, growth, viralityScore, zonedDayStart, type Bucket, type CoverageRow, type Growth, type SeriesPoint, type SeriesRow, type Virality,
} from "@/lib/analytics/buzz";

export interface TotalsRow {
  source: string;
  relevant: number;
  irrelevant: number;
  pending: number;
  posts: number;
  comments: number;
  engagement: number;
  unique_authors: number;
  with_author: number;
  duplicates_excluded: number;
  undated: number;
}

export interface PeriodTotals {
  relevant: number;
  irrelevant: number;
  pending: number;
  posts: number;
  comments: number;
  engagement: number;
  /** Sum of per-platform distinct authors (authors are platform-specific identities). */
  uniqueAuthors: number;
  /** Relevant mentions that have an author; unique authors are only measurable for these. */
  withAuthor: number;
  duplicatesExcluded: number;
  undated: number;
  bySource: TotalsRow[];
}

export interface BuzzDashboard {
  bucket: Bucket;
  sources: string[];
  series: SeriesPoint[];
  totals: PeriodTotals;
  previousTotals: PeriodTotals;
  rangeGrowth: Growth;
  today: number;
  yesterday: number;
  daily: Growth;
  weekly: Growth;
  monthly: Growth;
  coverage: { range: number; complete: number; gaps: number; partial: number };
  virality: Virality & { basis: string[] };
  spikes: Array<{ id: string; platform: string | null; granularity: string; period_start: string; period_end: string; observed: number; expected: number; ratio: number | null; severity: string; confidence: "confirmed" | "possible"; note: string | null; keyword?: string }>;
  /** Product-level spike evaluation state (insufficient data is shown, not hidden). */
  spikeEvaluation: { status: "evaluated" | "insufficient_data"; baselinePeriods: number; neededPeriods: number; evaluatedAt: string } | null;
  events: Array<{ id: string; title: string; kind: string; occurred_at: string; url: string | null }>;
}

function sumTotals(rows: TotalsRow[], sources: string[] | null): PeriodTotals {
  const list = sources ? rows.filter((r) => sources.includes(r.source)) : rows;
  const s = (k: keyof TotalsRow) => list.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  return {
    relevant: s("relevant"), irrelevant: s("irrelevant"), pending: s("pending"), posts: s("posts"), comments: s("comments"),
    engagement: s("engagement"), uniqueAuthors: s("unique_authors"), withAuthor: s("with_author"),
    duplicatesExcluded: s("duplicates_excluded"), undated: s("undated"), bySource: list,
  };
}

async function totals(sb: SupabaseClient, productId: string, from: Date, to: Date, sources: string[] | null): Promise<PeriodTotals> {
  const { data, error } = await sb.rpc("buzz_totals", { p_product_id: productId, p_from: from.toISOString(), p_to: to.toISOString(), p_sources: sources });
  if (error) throw new Error(`buzz_totals failed (${error.code ?? "db"})`);
  return sumTotals((data ?? []) as TotalsRow[], null);
}

async function coverageRows(sb: SupabaseClient, productId: string, from: Date, to: Date, bucket: Bucket, tz: string, sources: string[] | null) {
  const { data, error } = await sb.rpc("buzz_coverage", {
    p_product_id: productId, p_from: from.toISOString(), p_to: to.toISOString(), p_bucket: bucket, p_tz: tz, p_sources: sources,
  });
  if (error) throw new Error(`buzz_coverage failed (${error.code ?? "db"})`);
  return (data ?? []) as CoverageRow[];
}

/**
 * Share of [from,to) that monitoring covered, averaged across the given sources.
 * `complete` counts only windows that weren't cut short by page caps.
 */
function coveredShare(rows: CoverageRow[], sources: string[], field: "covered" | "complete" = "covered"): number {
  if (sources.length === 0) return 0;
  const buckets = new Set(rows.map((r) => new Date(r.bucket_start).getTime()));
  if (buckets.size === 0) return 0;
  let sum = 0;
  for (const r of rows) if (r.source && sources.includes(r.source)) sum += Math.min(1, Number(r[field]));
  return sum / (buckets.size * sources.length);
}

export async function getBuzzDashboard(
  sb: SupabaseClient,
  productId: string,
  range: { from: Date; to: Date },
  tz: string,
  sourceFilter: string[] | null,
  now = new Date(),
): Promise<BuzzDashboard> {
  const spanMs = range.to.getTime() - range.from.getTime();
  const bucket: Bucket = spanMs <= 2 * 86_400_000 ? "hour" : "day";
  const from = bucket === "day" ? zonedDayStart(range.from, tz) : new Date(Math.floor(range.from.getTime() / 3_600_000) * 3_600_000);
  const prev = { from: new Date(from.getTime() - (range.to.getTime() - from.getTime())), to: from };
  const H = 3_600_000;
  const D = 24 * H;
  const todayStart = zonedDayStart(now, tz);
  const yesterdayStart = zonedDayStart(now, tz, -1);

  const [seriesRes, cov, rangeTotals, prevTotals, t24, p24, today, yesterday, w, pw, m, pm, base, covGrowth, spikesRes, eventsRes, kwSpikesRes, evalRes] = await Promise.all([
    sb.rpc("buzz_series", { p_product_id: productId, p_from: from.toISOString(), p_to: range.to.toISOString(), p_bucket: bucket, p_tz: tz, p_sources: sourceFilter }),
    coverageRows(sb, productId, from, range.to, bucket, tz, sourceFilter),
    totals(sb, productId, from, range.to, sourceFilter),
    totals(sb, productId, prev.from, prev.to, sourceFilter),
    totals(sb, productId, new Date(now.getTime() - D), now, sourceFilter),
    totals(sb, productId, new Date(now.getTime() - 2 * D), new Date(now.getTime() - D), sourceFilter),
    totals(sb, productId, todayStart, now, sourceFilter),
    totals(sb, productId, yesterdayStart, todayStart, sourceFilter),
    totals(sb, productId, new Date(now.getTime() - 7 * D), now, sourceFilter),
    totals(sb, productId, new Date(now.getTime() - 14 * D), new Date(now.getTime() - 7 * D), sourceFilter),
    totals(sb, productId, new Date(now.getTime() - 30 * D), now, sourceFilter),
    totals(sb, productId, new Date(now.getTime() - 60 * D), new Date(now.getTime() - 30 * D), sourceFilter),
    totals(sb, productId, new Date(now.getTime() - 29 * D), new Date(now.getTime() - D), sourceFilter),
    coverageRows(sb, productId, new Date(Math.min(now.getTime() - 60 * D, prev.from.getTime())), now, "day", "UTC", sourceFilter),
    sb.from("buzz_spikes")
      .select("id, platform, granularity, period_start, period_end, observed, expected, ratio, severity, confidence, note")
      .eq("product_id", productId)
      .gte("period_start", prev.from.toISOString())
      .order("period_start", { ascending: false })
      .limit(50),
    sb.from("product_events")
      .select("id, title, kind, occurred_at, url")
      .eq("product_id", productId)
      .gte("occurred_at", from.toISOString())
      .lt("occurred_at", range.to.toISOString())
      .order("occurred_at"),
    sb.from("buzz_keyword_spikes")
      .select("id, keyword, granularity, period_start, period_end, observed, expected, ratio, severity, confidence, note")
      .eq("product_id", productId)
      .gte("period_start", prev.from.toISOString())
      .order("period_start", { ascending: false })
      .limit(30),
    sb.from("spike_evaluations").select("status, baseline_periods, needed_periods, evaluated_at, granularity")
      .eq("product_id", productId).eq("scope", "product").eq("scope_key", "").eq("granularity", bucket).maybeSingle(),
  ]);
  if (seriesRes.error) throw new Error(`buzz_series failed (${seriesRes.error.code ?? "db"})`);

  const rows = (seriesRes.data ?? []) as SeriesRow[];
  // Platforms in this view: those monitored in the range or with data in it.
  const monitored = new Set<string>();
  for (const c of cov) if (c.source) monitored.add(c.source);
  for (const r of rows) monitored.add(r.source);
  const sources = [...monitored].sort();
  const bucketStarts = [...new Set(cov.map((c) => new Date(c.bucket_start).toISOString()))].sort();
  const series = buildSeries(bucketStarts, sources, rows, cov);

  const share = (fromD: Date, toD: Date) => {
    const inRange = covGrowth.filter((c) => {
      const t = new Date(c.bucket_start).getTime();
      return t >= fromD.getTime() - D && t < toD.getTime();
    });
    return coveredShare(inRange, sources, "complete");
  };

  const baselineDays = (() => {
    const per = new Map<number, number>();
    for (const c of covGrowth) {
      const t = new Date(c.bucket_start).getTime();
      if (t < now.getTime() - 29 * D || t >= now.getTime() - D || !c.source) continue;
      per.set(t, Math.max(per.get(t) ?? 0, Number(c.covered)));
    }
    return [...per.values()].filter((v) => v >= 0.5).length;
  })();
  const baselineDivisor = Math.max(baselineDays, 1);

  // Virality compares the last day with the usual level, so it only uses platforms that were
  // completely monitored over the whole baseline: a capped backfill would fake "growth".
  const completeSources = sources.filter((src) => {
    const rows = covGrowth.filter((c) => c.source === src && new Date(c.bucket_start).getTime() >= now.getTime() - 29 * D);
    return rows.length > 0 && rows.reduce((a, c) => a + Number(c.complete), 0) / rows.length >= 0.9;
  });
  const sameSet = completeSources.length === sources.length;
  const [vt24, vp24, vbase] = sameSet ? [t24, p24, base] : completeSources.length === 0 ? [null, null, null] : await Promise.all([
    totals(sb, productId, new Date(now.getTime() - D), now, completeSources),
    totals(sb, productId, new Date(now.getTime() - 2 * D), new Date(now.getTime() - D), completeSources),
    totals(sb, productId, new Date(now.getTime() - 29 * D), new Date(now.getTime() - D), completeSources),
  ]);
  const virality: Virality & { basis: string[] } = vt24 && vp24 && vbase
    ? {
        ...viralityScore({
          last24h: vt24.relevant,
          prev24h: vp24.relevant,
          baselineDaily: vbase.relevant / baselineDivisor,
          baselineDays,
          authors24h: vt24.uniqueAuthors,
          baselineAuthorsDaily: vbase.uniqueAuthors / baselineDivisor,
          engagementPerMention24h: vt24.relevant ? vt24.engagement / vt24.relevant : 0,
          baselineEngagementPerMention: vbase.relevant ? vbase.engagement / vbase.relevant : 0,
          platforms24h: vt24.bySource.filter((s) => Number(s.relevant) > 0).length,
        }),
        basis: completeSources,
      }
    : { score: null, confidence: "low", factors: [], basis: [], note: "No platform was completely monitored over the last 4 weeks, so attention growth can't be measured reliably yet." };

  return {
    bucket,
    sources,
    series,
    totals: rangeTotals,
    previousTotals: prevTotals,
    rangeGrowth: growth(rangeTotals.relevant, prevTotals.relevant, { current: share(from, range.to), previous: share(prev.from, prev.to) }),
    today: today.relevant,
    yesterday: yesterday.relevant,
    daily: growth(t24.relevant, p24.relevant, { current: share(new Date(now.getTime() - D), now), previous: share(new Date(now.getTime() - 2 * D), new Date(now.getTime() - D)) }),
    weekly: growth(w.relevant, pw.relevant, { current: share(new Date(now.getTime() - 7 * D), now), previous: share(new Date(now.getTime() - 14 * D), new Date(now.getTime() - 7 * D)) }),
    monthly: growth(m.relevant, pm.relevant, { current: share(new Date(now.getTime() - 30 * D), now), previous: share(new Date(now.getTime() - 60 * D), new Date(now.getTime() - 30 * D)) }),
    coverage: {
      range: coveredShare(cov, sources),
      complete: coveredShare(cov, sources, "complete"),
      gaps: series.filter((p) => p.coverage === "none").length,
      partial: series.filter((p) => p.coverage === "partial").length,
    },
    virality,
    spikes: [
      ...((spikesRes.data ?? []) as BuzzDashboard["spikes"]),
      ...((kwSpikesRes.data ?? []) as Array<BuzzDashboard["spikes"][number] & { keyword: string }>).map((k) => ({ ...k, platform: null, id: `kw-${k.id}` })),
    ].sort((a, b) => b.period_start.localeCompare(a.period_start)),
    spikeEvaluation: evalRes.data
      ? { status: evalRes.data.status as "evaluated" | "insufficient_data", baselinePeriods: evalRes.data.baseline_periods as number, neededPeriods: evalRes.data.needed_periods as number, evaluatedAt: evalRes.data.evaluated_at as string }
      : null,
    events: (eventsRes.data ?? []) as BuzzDashboard["events"],
  };
}
