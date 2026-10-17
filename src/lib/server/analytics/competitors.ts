import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  alignDaily, comparableSources, comparisonWindow, shareOfVoice, summarizeSentiment,
  type ComparisonWindow, type Entity, type SentimentCounts, type SentimentSummary, type VoiceRow,
} from "@/lib/analytics/competitors";
import { zonedDayStart } from "@/lib/analytics/buzz";

export interface CompetitorRow {
  id: string;
  name: string;
  websiteUrl: string | null;
  keywords: string[];
  enabled: boolean;
  trackingProductId: string | null;
  trackedSince: string | null;
}

export interface CompetitorComparison {
  competitors: CompetitorRow[];
  /** Entities compared (the product first, then enabled competitors in the order they were added). */
  entities: Array<{ id: string; name: string; isProduct: boolean }>;
  window: ComparisonWindow;
  sources: { common: string[]; excluded: Array<{ source: string; missingFor: string[] }> };
  voice: VoiceRow[];
  daily: Array<Record<string, number | string>>;
  sentiment: Array<{ id: string; name: string; isProduct: boolean; summary: SentimentSummary }>;
}

/** Competitor settings plus the comparison over the requested range (as the viewer, under RLS). */
export async function getCompetitorComparison(
  sb: SupabaseClient,
  product: { id: string; name: string; createdAt: string },
  range: { from: Date; to: Date },
  tz: string,
): Promise<CompetitorComparison> {
  const { data: comps, error } = await sb.from("competitors")
    .select("id, name, website_url, keywords, enabled, tracking_product_id, created_at")
    .eq("product_id", product.id).order("created_at").order("id");
  if (error) throw new Error(`load competitors: ${error.message}`);
  const competitors: CompetitorRow[] = (comps ?? []).map((c) => ({
    id: c.id as string, name: c.name as string, websiteUrl: (c.website_url as string | null) ?? null, keywords: (c.keywords as string[]) ?? [],
    enabled: Boolean(c.enabled), trackingProductId: (c.tracking_product_id as string | null) ?? null, trackedSince: c.created_at as string,
  }));

  const active = competitors.filter((c) => c.enabled && c.trackingProductId);
  const ids = [product.id, ...active.map((c) => c.trackingProductId!)];
  const { data: queries } = await sb.from("monitoring_queries").select("product_id, provider").in("product_id", ids).eq("enabled", true);
  const sourcesOf = (id: string) => [...new Set((queries ?? []).filter((q) => q.product_id === id).map((q) => q.provider as string))];

  const entities: Entity[] = [
    { id: product.id, name: product.name, isProduct: true, trackedSince: new Date(product.createdAt), sources: sourcesOf(product.id) },
    ...active.map((c) => ({ id: c.trackingProductId!, name: c.name, isProduct: false, trackedSince: new Date(c.trackedSince!), sources: sourcesOf(c.trackingProductId!) })),
  ];
  const fromDay = zonedDayStart(range.from, tz);
  const window = comparisonWindow(fromDay, range.to, entities);
  const sources = comparableSources(entities);
  const meta = entities.map((e) => ({ id: e.id, name: e.name, isProduct: e.isProduct }));

  if (active.length === 0 || window.empty || sources.common.length === 0) {
    return { competitors, entities: meta, window, sources, voice: [], daily: [], sentiment: [] };
  }

  const p = { p_from: window.from.toISOString(), p_to: window.to.toISOString() };
  const results = await Promise.all(entities.map(async (e) => {
    const [series, feedback] = await Promise.all([
      sb.rpc("buzz_series", { p_product_id: e.id, ...p, p_bucket: "day", p_tz: tz, p_sources: sources.common }),
      sb.rpc("feedback_daily", { p_product_id: e.id, ...p, p_tz: tz }),
    ]);
    if (series.error) throw new Error(`buzz_series failed (${series.error.code ?? "db"})`);
    if (feedback.error) throw new Error(`feedback_daily failed (${feedback.error.code ?? "db"})`);
    const perDay = new Map<string, number>();
    for (const r of (series.data ?? []) as Array<{ bucket_start: string; relevant: number }>) {
      const day = dayIn(new Date(r.bucket_start), tz);
      perDay.set(day, (perDay.get(day) ?? 0) + Number(r.relevant ?? 0));
    }
    return { e, days: [...perDay].map(([day, mentions]) => ({ day, mentions })), feedback: (feedback.data ?? []) as SentimentCounts[] };
  }));

  return {
    competitors, entities: meta, window, sources,
    voice: shareOfVoice(results.map((r) => ({ id: r.e.id, name: r.e.name, isProduct: r.e.isProduct, mentions: r.days.reduce((s, d) => s + d.mentions, 0) }))),
    daily: alignDaily(window.from, window.to, results.map((r) => ({ id: r.e.id, days: r.days })), (d) => dayIn(d, tz)),
    sentiment: results.map((r) => ({ id: r.e.id, name: r.e.name, isProduct: r.e.isProduct, summary: summarizeSentiment(r.feedback) })),
  };
}

/** Calendar day (YYYY-MM-DD) of an instant in a time zone. */
function dayIn(t: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
}
