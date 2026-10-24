import type { Metadata } from "next";
import Link from "next/link";
import { PackagePlus, Radar } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, requireWorkspace } from "@/lib/server/session";
import { CoverageNotice, EmptyState, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { getCoverageSummary } from "@/lib/server/collection/status";
import { getBuzzDashboard } from "@/lib/server/analytics/buzz";
import { getCompetitorComparison } from "@/lib/server/analytics/competitors";
import { integrationInfo } from "@/lib/domain/integrations";
import { parseRange } from "@/lib/domain/date-range";
import { categoryLabel } from "@/lib/ai/cluster";
import type { FeedbackCategory } from "@/lib/ai/types";
import { getTimeZone } from "@/lib/server/timezone";
import { OverviewBoard, type OverviewData } from "./overview-board";

export const metadata: Metadata = { title: "Overview" };

const NOTICES: Record<string, string> = { password_updated: "Your password was updated." };

/** Each platform keeps one colour wherever it appears (colour follows the platform, never its rank). */
const PLATFORM_COLOR: Record<string, string> = {
  x: "var(--entity-1)", youtube: "var(--entity-2)", app_store: "var(--entity-3)", linkedin: "var(--entity-4)",
  instagram: "var(--entity-5)", facebook: "var(--entity-6)", reddit: "var(--chart-6)", tiktok: "var(--chart-4)",
  web: "var(--chart-2)", news: "var(--chart-5)",
};
const KIND: Partial<Record<FeedbackCategory, { label: string; color: string }>> = {
  bug_report: { label: "Bug", color: "var(--feedback-bug)" }, security_concern: { label: "Security", color: "var(--feedback-bug)" },
  feature_request: { label: "Feature request", color: "var(--feedback-feature)" },
  complaint: { label: "Complaint", color: "var(--feedback-complaint)" }, usability_complaint: { label: "Usability", color: "var(--feedback-complaint)" },
  pricing_complaint: { label: "Pricing", color: "var(--feedback-complaint)" }, performance_issue: { label: "Performance", color: "var(--feedback-complaint)" },
};
const TREND: Record<string, string> = { new: "New this week", worsening: "Worsening", growing: "Growing", steady: "Steady", declining: "Declining" };
const nameOf = (id: string) => integrationInfo(id as never)?.name.replace(/ \/ Stack Exchange$/, "").replace(/ \((Twitter|Google Search|Google News)\)$/, "") ?? id;

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tz = await getTimeZone();
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  const sp = await searchParams;
  const notice = NOTICES[sp.notice ?? ""];

  if (!product) {
    return (
      <>
        <PageHeader title="Overview" />
        <EmptyState icon={PackagePlus} title="Add your first product" action={{ href: "/onboarding/product", label: "Add product" }}>
          SignalForge listens for conversations about a product you choose. Add one to get started.
        </EmptyState>
      </>
    );
  }

  const supabase = await createClient();
  const now = new Date();
  const range = parseRange(sp, now);
  const coverage = await getCoverageSummary(product.id);
  if (coverage.included.length === 0) {
    return (
      <>
        <PageHeader title={product.name} description="Overview" />
        <EmptyState icon={Radar} title="No data yet" action={{ href: `/onboarding/${product.id}/scan`, label: "Run first scan" }}>
          Nothing is shown until a source has been searched: no data isn&apos;t the same as no mentions.
        </EmptyState>
      </>
    );
  }

  const [{ data: p }, dash, feedback, { data: issueRows }, { count: openCount }, { count: highCount }, { data: feedRows }] = await Promise.all([
    supabase.from("products").select("created_at").eq("id", product.id).single(),
    getBuzzDashboard(supabase, product.id, range, tz, null, now),
    supabase.rpc("feedback_daily", { p_product_id: product.id, p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_tz: tz }),
    supabase.from("feedback_clusters").select("id, category, title, report_count, unique_reporters, suggested_priority, priority_evidence")
      .eq("product_id", product.id).in("status", ["open", "acknowledged"])
      .order("priority_score", { ascending: false, nullsFirst: false }).order("report_count", { ascending: false }).limit(6),
    supabase.from("feedback_clusters").select("id", { count: "exact", head: true }).eq("product_id", product.id).in("status", ["open", "acknowledged"]),
    supabase.from("feedback_clusters").select("id", { count: "exact", head: true }).eq("product_id", product.id).in("status", ["open", "acknowledged"]).in("suggested_priority", ["high", "critical"]),
    supabase.from("mentions").select("id, source, source_url, title, content, author_display, published_at, sentiment")
      .eq("product_id", product.id).eq("dedup_kind", "original").in("relevance_status", ["relevant", "user_relevant"])
      .order("published_at", { ascending: false }).limit(8),
  ]);
  // Competitors are a bonus panel: if they can't load, the rest of the page still renders.
  const comparison = await getCompetitorComparison(supabase, { id: product.id, name: product.name, createdAt: p?.created_at as string }, range, tz).catch(() => null);

  type Sent = { positive: number; negative: number; neutral: number; classified: number };
  const sent = ((feedback.data ?? []) as Array<Record<string, number>>).reduce<Sent>(
    (a, d) => ({ positive: a.positive + Number(d.positive ?? 0), negative: a.negative + Number(d.negative ?? 0), neutral: a.neutral + Number(d.neutral ?? 0) + Number(d.mixed ?? 0) + Number(d.uncertain ?? 0), classified: a.classified + Number(d.classified ?? 0) }),
    { positive: 0, negative: 0, neutral: 0, classified: 0 },
  );
  const fmt = new Intl.DateTimeFormat("en-US", dash.bucket === "hour" ? { hour: "numeric", timeZone: tz } : { month: "short", day: "numeric", timeZone: tz });
  const full = new Intl.DateTimeFormat("en-US", dash.bucket === "hour" ? { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz } : { weekday: "short", month: "short", day: "numeric", timeZone: tz });
  const prev = new Map(dash.previousTotals.bySource.map((r) => [r.source, Number(r.relevant)]));
  const sources = dash.totals.bySource.map((r) => ({ id: r.source, value: Number(r.relevant) })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const top = sources.slice(0, 7);
  const rest = sources.slice(7);
  const voiceColors = ["var(--entity-1)", "var(--entity-2)", "var(--entity-3)", "var(--entity-4)", "var(--entity-5)", "var(--entity-6)"];
  const voice = (comparison?.voice ?? []).map((v, i) => ({ name: v.name, share: v.share, isProduct: v.isProduct, color: voiceColors[i % voiceColors.length]! }));

  const data: OverviewData = {
    product: product.name,
    period: range.label.toLowerCase().replace(/^last /, ""),
    kpis: {
      mentions: dash.totals.relevant, mentionsChange: dash.rangeGrowth.change,
      today: dash.today, yesterday: dash.yesterday,
      negativeShare: sent.classified > 0 ? sent.negative / sent.classified : null, classified: sent.classified,
      openIssues: openCount ?? 0, highIssues: highCount ?? 0,
      sov: voice.find((v) => v.isProduct)?.share ?? null, competitors: Math.max(0, voice.length - 1),
    },
    series: dash.series.map((s) => ({ label: fmt.format(new Date(s.start)), full: full.format(new Date(s.start)), value: s.relevant })),
    platforms: top.map((s) => ({ id: s.id, name: nameOf(s.id), value: s.value, prev: prev.get(s.id) ?? 0, color: PLATFORM_COLOR[s.id] ?? "var(--chart-8)" })),
    otherPlatforms: { count: rest.length, value: rest.reduce((t, r) => t + r.value, 0) },
    issues: ((issueRows ?? []) as Array<{ id: string; category: FeedbackCategory; title: string; report_count: number; unique_reporters: number | null; suggested_priority: string | null; priority_evidence: { observed?: { trend?: string } } | null }>).map((c) => ({
      id: c.id, title: c.title, kind: KIND[c.category]?.label ?? categoryLabel(c.category), kindColor: KIND[c.category]?.color ?? "var(--muted-foreground)",
      people: c.unique_reporters ?? c.report_count, trend: TREND[c.priority_evidence?.observed?.trend ?? ""] ?? null, priority: c.suggested_priority,
    })),
    voice,
    sentiment: sent.classified > 0 ? sent : null,
    feed: ((feedRows ?? []) as Array<{ id: string; source: string; source_url: string; title: string | null; content: string | null; author_display: string | null; published_at: string; sentiment: string | null }>).map((m) => ({
      id: m.id, platform: nameOf(m.source), author: m.author_display, text: (m.title || m.content || m.source_url).replace(/\s+/g, " ").slice(0, 220),
      url: m.source_url, at: m.published_at, sentiment: m.sentiment,
    })),
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-0.5">
          <h1 className="text-xl font-semibold tracking-[-0.02em]">{product.name}</h1>
          <p className="text-[13px] text-muted-foreground">Overview · {range.label}</p>
        </div>
        {product.onboardingStep < 6 && <Button asChild size="sm"><Link href="/onboarding">Finish setup</Link></Button>}
      </div>
      {notice && <p role="status" className="mb-4 rounded-md border bg-muted px-3 py-2 text-[13px]">{notice}</p>}
      <CoverageNotice />
      <OverviewBoard d={data} />
    </>
  );
}
