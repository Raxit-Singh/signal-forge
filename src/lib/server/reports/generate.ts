import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { coverageRows, coveredShare, totals } from "@/lib/server/analytics/buzz";
import { getCompetitorComparison } from "@/lib/server/analytics/competitors";
import { integrationInfo } from "@/lib/domain/integrations";
import { highlights, lastCompleteWeek, REPORT_VERSION, type PeriodNumbers, type ReportData } from "@/lib/reports/weekly";

const sourceName = (id: string) => integrationInfo(id as never)?.name.replace(/ \/ Stack Exchange$/, "") ?? id;
const DAY = 86_400_000;

type Feedback = { classified: number; unclassified: number; positive: number; negative: number; neutral: number; mixed: number; uncertain: number; bugs: number; features: number; complaints: number; praise: number; questions: number };

async function periodNumbers(admin: SupabaseClient, productId: string, from: Date, to: Date, sources: string[]): Promise<PeriodNumbers> {
  const [t, cov, fb] = await Promise.all([
    totals(admin, productId, from, to, null),
    coverageRows(admin, productId, from, to, "day", "UTC", null),
    admin.rpc("feedback_daily", { p_product_id: productId, p_from: from.toISOString(), p_to: to.toISOString(), p_tz: "UTC" }),
  ]);
  if (fb.error) throw new Error(`feedback_daily failed (${fb.error.code ?? "db"})`);
  const f = ((fb.data ?? []) as Feedback[]).reduce((a, d) => {
    for (const k of Object.keys(a) as Array<keyof Feedback>) a[k] += Number(d[k] ?? 0);
    return a;
  }, { classified: 0, unclassified: 0, positive: 0, negative: 0, neutral: 0, mixed: 0, uncertain: 0, bugs: 0, features: 0, complaints: 0, praise: 0, questions: 0 });
  return {
    mentions: t.relevant, posts: t.posts, comments: t.comments, uniqueAuthors: t.uniqueAuthors, engagement: t.engagement,
    coverage: coveredShare(cov, sources),
    bySource: t.bySource.map((s) => ({ source: s.source, mentions: Number(s.relevant) })).filter((s) => s.mentions > 0).sort((a, b) => b.mentions - a.mentions),
    sentiment: { classified: f.classified, unclassified: f.unclassified, positive: f.positive, negative: f.negative, neutral: f.neutral, mixed: f.mixed, uncertain: f.uncertain },
    feedback: { bugs: f.bugs, features: f.features, complaints: f.complaints, praise: f.praise, questions: f.questions },
  };
}

/**
 * Computes a report for one product and period from stored data and stores it
 * (one per product, kind and start). Returns null without storing when nothing
 * was monitored in the period (no empty reports).
 */
export async function generateReport(
  admin: SupabaseClient, productId: string, kind: "weekly" | "custom", period: { start: Date; end: Date }, now = new Date(),
): Promise<{ id: string } | null> {
  const { data: p } = await admin.from("products").select("id, workspace_id, name, created_at, competitor_of, archived_at").eq("id", productId).maybeSingle();
  if (!p || p.competitor_of || p.archived_at) return null;
  const { data: q } = await admin.from("monitoring_queries").select("provider").eq("product_id", productId).eq("enabled", true);
  const sources = [...new Set((q ?? []).map((r) => r.provider as string))];
  const span = period.end.getTime() - period.start.getTime();
  const prev = { start: new Date(period.start.getTime() - span), end: period.start };

  const [current, previous, series, spikesRes, kwSpikesRes, topRes, periodMentions] = await Promise.all([
    periodNumbers(admin, productId, period.start, period.end, sources),
    periodNumbers(admin, productId, prev.start, prev.end, sources),
    admin.rpc("buzz_series", { p_product_id: productId, p_from: period.start.toISOString(), p_to: period.end.toISOString(), p_bucket: "day", p_tz: "UTC", p_sources: null }),
    admin.from("buzz_spikes").select("period_start, platform, observed, expected, severity, confidence").eq("product_id", productId)
      .gte("period_start", period.start.toISOString()).lt("period_start", period.end.toISOString()).order("observed", { ascending: false }).limit(10),
    admin.from("buzz_keyword_spikes").select("period_start, keyword, observed, expected, severity, confidence").eq("product_id", productId)
      .gte("period_start", period.start.toISOString()).lt("period_start", period.end.toISOString()).order("observed", { ascending: false }).limit(10),
    admin.from("mentions").select("title, content, source_url, source, published_at, engagement_score").eq("product_id", productId).eq("dedup_kind", "original")
      .in("relevance_status", ["relevant", "user_relevant"]).eq("published_at_estimated", false)
      .gte("published_at", period.start.toISOString()).lt("published_at", period.end.toISOString())
      .order("engagement_score", { ascending: false }).limit(5),
    admin.from("mentions").select("id").eq("product_id", productId).eq("dedup_kind", "original")
      .gte("published_at", period.start.toISOString()).lt("published_at", period.end.toISOString()).limit(5000),
  ]);
  if (current.coverage === 0 && current.mentions === 0) return null;
  if (series.error) throw new Error(`buzz_series failed (${series.error.code ?? "db"})`);

  const perDay = new Map<string, number>();
  for (let t = period.start.getTime(); t < period.end.getTime(); t += DAY) perDay.set(new Date(t).toISOString().slice(0, 10), 0);
  for (const r of (series.data ?? []) as Array<{ bucket_start: string; relevant: number }>) {
    const d = new Date(r.bucket_start).toISOString().slice(0, 10);
    perDay.set(d, (perDay.get(d) ?? 0) + Number(r.relevant ?? 0));
  }

  // Issues with posts in the period (open or acknowledged).
  const ids = (periodMentions.data ?? []).map((m) => m.id as string);
  const perCluster = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data: mem } = await admin.from("feedback_cluster_members").select("cluster_id").in("mention_id", ids.slice(i, i + 500));
    for (const m of mem ?? []) perCluster.set(m.cluster_id as string, (perCluster.get(m.cluster_id as string) ?? 0) + 1);
  }
  const { data: clusters } = perCluster.size
    ? await admin.from("feedback_clusters").select("id, title, category, suggested_priority, report_count, first_detected_at, priority_score, priority_evidence, status")
      .in("id", [...perCluster.keys()]).in("status", ["open", "acknowledged"])
    : { data: [] };
  const issues = (clusters ?? []).map((c) => ({
    id: c.id as string, title: c.title as string, category: c.category as string, priority: (c.suggested_priority as string | null) ?? null,
    postsInPeriod: perCluster.get(c.id as string) ?? 0, reporters: Number(c.report_count ?? 0),
    isNew: Boolean(c.first_detected_at && Date.parse(c.first_detected_at as string) >= period.start.getTime() && Date.parse(c.first_detected_at as string) < period.end.getTime()),
    trend: ((c.priority_evidence as { observed?: { trend?: string } } | null)?.observed?.trend) ?? null,
    score: Number(c.priority_score ?? 0),
  })).sort((a, b) => b.score - a.score || b.postsInPeriod - a.postsInPeriod).slice(0, 10).map(({ score: _s, ...rest }) => rest);

  const spikeRow = (r: Record<string, unknown>, platform: string | null, keyword: string | null) => ({
    start: r.period_start as string, platform, keyword, observed: Number(r.observed),
    expected: Math.round(Number(r.expected) * 10) / 10, severity: r.severity as string, confidence: r.confidence as string,
  });
  const spikes = [
    ...((spikesRes.data ?? []) as Array<Record<string, unknown>>).map((r) => spikeRow(r, (r.platform as string | null) ?? null, null)),
    ...((kwSpikesRes.data ?? []) as Array<Record<string, unknown>>).map((r) => spikeRow(r, null, r.keyword as string)),
  ].sort((a, b) => a.start.localeCompare(b.start));

  let competitors: ReportData["competitors"] = null;
  try {
    const cmp = await getCompetitorComparison(admin, { id: p.id as string, name: p.name as string, createdAt: p.created_at as string }, { from: period.start, to: period.end }, "UTC");
    if (cmp.voice.length > 1) competitors = { sources: cmp.sources.common, rows: cmp.voice.map((v) => ({ name: v.name, isProduct: v.isProduct, mentions: v.mentions, share: v.share })) };
  } catch (e) {
    console.error(`[reports] competitor comparison failed: ${e instanceof Error ? e.message : e}`);
  }

  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const body: Omit<ReportData, "highlights"> = {
    version: REPORT_VERSION,
    product: { id: p.id as string, name: p.name as string },
    period: { start: period.start.toISOString(), end: period.end.toISOString(), label: `${fmt(period.start)} – ${fmt(new Date(period.end.getTime() - 1))} (UTC)` },
    generatedAt: now.toISOString(),
    current, previous,
    daily: [...perDay].map(([day, mentions]) => ({ day, mentions })),
    issues, spikes, competitors,
    topPosts: ((topRes.data ?? []) as Array<Record<string, unknown>>).map((m) => ({
      title: String(m.title || m.content || "Untitled post").replace(/\s+/g, " ").slice(0, 160), url: m.source_url as string, source: m.source as string,
      publishedAt: m.published_at as string, engagement: Number(m.engagement_score ?? 0),
    })),
  };
  const data: ReportData = { ...body, highlights: highlights(body, sourceName) };

  const { data: row, error } = await admin.from("reports").upsert({
    workspace_id: p.workspace_id, product_id: p.id, kind, period_start: period.start.toISOString(), period_end: period.end.toISOString(),
    status: "ready", data, created_at: now.toISOString(),
  }, { onConflict: "product_id,kind,period_start" }).select("id").single();
  if (error || !row) throw new Error(`save report: ${error?.message}`);
  return { id: row.id as string };
}

/** Daily: last week's report for every active product that doesn't have one yet. */
export async function generateWeeklyReports(admin: SupabaseClient, now = new Date(), limit = 100): Promise<number> {
  const week = lastCompleteWeek(now);
  const { data: products } = await admin.from("products").select("id").is("archived_at", null).is("competitor_of", null)
    .lt("created_at", week.end.toISOString()).limit(limit);
  const { data: existing } = await admin.from("reports").select("product_id").eq("kind", "weekly").eq("period_start", week.start.toISOString());
  const done = new Set((existing ?? []).map((r) => r.product_id as string));
  let n = 0;
  for (const p of products ?? []) {
    if (done.has(p.id as string)) continue;
    try {
      if (await generateReport(admin, p.id as string, "weekly", week, now)) n++;
    } catch (e) {
      console.error(`[reports] product ${p.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return n;
}
