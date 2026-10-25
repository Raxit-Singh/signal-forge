import type { Metadata } from "next";
import Link from "next/link";
import { PackagePlus, Radar } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, requireWorkspace } from "@/lib/server/session";
import { EmptyState, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { getCoverageSummary } from "@/lib/server/collection/status";
import { getBuzzDashboard } from "@/lib/server/analytics/buzz";
import { integrationInfo } from "@/lib/domain/integrations";
import { parseRange } from "@/lib/domain/date-range";
import type { FeedbackCategory } from "@/lib/ai/types";
import { getTimeZone } from "@/lib/server/timezone";
import { OverviewBoard, type OverviewData } from "./overview-board";

export const metadata: Metadata = { title: "Overview" };

const NOTICES: Record<string, string> = { password_updated: "Your password was updated." };

// Open issues grouped for the donut (largest groups first in the legend).
const KIND_GROUP: Partial<Record<FeedbackCategory, string>> = {
  bug_report: "Bugs", security_concern: "Bugs", performance_issue: "Bugs",
  complaint: "Complaints", usability_complaint: "Complaints", pricing_complaint: "Complaints",
  feature_request: "Feature requests", support_question: "Questions",
};
// Topics a classified mention flows into on the platform → topic chart.
const TOPIC: Partial<Record<FeedbackCategory, { id: string; name: string }>> = {
  bug_report: { id: "bug", name: "Bugs" }, security_concern: { id: "bug", name: "Bugs" }, performance_issue: { id: "bug", name: "Bugs" },
  complaint: { id: "cmp", name: "Complaints" }, usability_complaint: { id: "cmp", name: "Complaints" }, pricing_complaint: { id: "cmp", name: "Complaints" },
  feature_request: { id: "ftr", name: "Feature requests" }, positive_review: { id: "prs", name: "Praise" }, support_question: { id: "q", name: "Questions" },
};
const nameOf = (id: string) => integrationInfo(id as never)?.name.replace(/ \/ Stack Exchange$/, "").replace(/ \((Twitter|Google Search|Google News)\)$/, "") ?? id;
const change = (cur: number, prev: number) => (prev > 0 ? cur / prev - 1 : null);

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tz = await getTimeZone();
  const { user, workspace } = await requireWorkspace();
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

  const relevant = ["relevant", "user_relevant"];
  const [dash, feedback, { data: openRows }, { data: feedRows }, { data: timeRows }, { data: flowRows }] = await Promise.all([
    getBuzzDashboard(supabase, product.id, range, tz, null, now),
    supabase.rpc("feedback_daily", { p_product_id: product.id, p_from: range.from.toISOString(), p_to: range.to.toISOString(), p_tz: tz }),
    supabase.from("feedback_clusters").select("id, title, category")
      .eq("product_id", product.id).in("status", ["open", "acknowledged"])
      .order("priority_score", { ascending: false, nullsFirst: false }).order("report_count", { ascending: false }).limit(1000),
    supabase.from("mentions").select("id, source, source_url, title, content, author_display, published_at, sentiment")
      .eq("product_id", product.id).eq("dedup_kind", "original").in("relevance_status", relevant)
      .order("published_at", { ascending: false }).limit(6),
    // When people talk: publication times in the period (weekday × hour).
    supabase.from("mentions").select("published_at")
      .eq("product_id", product.id).eq("dedup_kind", "original").in("relevance_status", relevant).eq("published_at_estimated", false)
      .gte("published_at", range.from.toISOString()).lt("published_at", range.to.toISOString()).limit(5000),
    // Platform → topic: classified mentions in the period.
    supabase.from("mentions").select("source, feedback_category")
      .eq("product_id", product.id).eq("dedup_kind", "original").in("relevance_status", relevant).eq("processing_status", "classified")
      .not("feedback_category", "is", null)
      .gte("published_at", range.from.toISOString()).lt("published_at", range.to.toISOString()).limit(5000),
  ]);

  // Weekday (Mon=0) × hour grid in the viewer's time zone.
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" });
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (const r of (timeRows ?? []) as Array<{ published_at: string }>) {
    const f = parts.formatToParts(new Date(r.published_at));
    const wd = DAYS.indexOf(f.find((x) => x.type === "weekday")?.value ?? "");
    const hr = Number(f.find((x) => x.type === "hour")?.value ?? -1);
    if (wd >= 0 && hr >= 0 && hr < 24) heat[wd]![hr]!++;
  }

  // Sentiment per day: totals for the hero, negatives for the chart, and the weekday capsules.
  const daily = (feedback.data ?? []) as Array<{ day: string } & Record<string, number>>;
  const sent = { positive: 0, negative: 0, classified: 0 };
  const negByDay = new Map<string, number>();
  const week = DAYS.map((d) => ({ d, negative: 0, classified: 0 }));
  for (const r of daily) {
    sent.positive += Number(r.positive ?? 0);
    sent.negative += Number(r.negative ?? 0);
    sent.classified += Number(r.classified ?? 0);
    negByDay.set(r.day, Number(r.negative ?? 0));
    const w = week[(new Date(`${r.day}T00:00:00Z`).getUTCDay() + 6) % 7]!;
    w.negative += Number(r.negative ?? 0);
    w.classified += Number(r.classified ?? 0);
  }

  // Platforms: shares of the period, change against the previous period, a line per platform.
  const prev = new Map(dash.previousTotals.bySource.map((r) => [r.source, Number(r.relevant)]));
  const sources = dash.totals.bySource.map((r) => ({ id: r.source, value: Number(r.relevant) })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const total = dash.totals.relevant;
  const rest = sources.slice(3);

  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const hourly = dash.bucket === "hour";
  const short = new Intl.DateTimeFormat("en-US", hourly ? { hour: "numeric", timeZone: tz } : { month: "short", day: "numeric", timeZone: tz });
  const full = new Intl.DateTimeFormat("en-US", hourly ? { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz } : { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: tz });
  const dom = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: tz });

  // Open issues by kind, and the top one for the hero action.
  const open = (openRows ?? []) as Array<{ id: string; title: string; category: FeedbackCategory }>;
  const kindCount = new Map<string, number>();
  for (const c of open) { const k = KIND_GROUP[c.category] ?? "Other"; kindCount.set(k, (kindCount.get(k) ?? 0) + 1); }

  // Flow: top three platforms by classified volume into the topics they talk about.
  const flowCount = new Map<string, Map<string, number>>();
  const bySrc = new Map<string, number>();
  for (const r of (flowRows ?? []) as Array<{ source: string; feedback_category: FeedbackCategory }>) {
    const t = TOPIC[r.feedback_category];
    if (!t) continue;
    bySrc.set(r.source, (bySrc.get(r.source) ?? 0) + 1);
    const m = flowCount.get(r.source) ?? new Map<string, number>();
    m.set(t.id, (m.get(t.id) ?? 0) + 1);
    flowCount.set(r.source, m);
  }
  const flowFrom = [...bySrc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const topics = new Map<string, { id: string; name: string; v: number }>();
  const links: Array<[string, string, number]> = [];
  for (const [src] of flowFrom) for (const [tid, v] of flowCount.get(src)!) {
    const t = Object.values(TOPIC).find((x) => x!.id === tid)!;
    topics.set(tid, { ...t, v: (topics.get(tid)?.v ?? 0) + v });
    links.push([src, tid, v]);
  }
  const ORDER = ["bug", "cmp", "ftr", "q", "prs"];

  const hourNow = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
  const first = (meta?.full_name ?? meta?.name ?? "").trim().split(/\s+/)[0] || null;

  const data: OverviewData = {
    product: product.name,
    greeting: hourNow < 5 ? "Good evening" : hourNow < 12 ? "Good morning" : hourNow < 18 ? "Good afternoon" : "Good evening",
    name: first,
    rangeKey: range.custom ? "custom" : range.key,
    period: range.label.replace(/^Last /, "last "),
    from: new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: tz }).format(range.from),
    to: new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: tz }).format(range.to),
    total,
    change: dash.rangeGrowth.change,
    perDay: Math.round(total / Math.max(1, range.days)),
    sentiment: sent.classified > 0 ? { positive: sent.positive / sent.classified, negative: sent.negative / sent.classified } : null,
    sourcesLive: coverage.included.length,
    topIssue: open[0] ? { id: open[0].id, title: open[0].title } : null,
    mix: [
      ...sources.slice(0, 3).map((s) => ({ name: nameOf(s.id), share: s.value / Math.max(1, total), change: change(s.value, prev.get(s.id) ?? 0), value: s.value })),
      ...(rest.length ? [{ name: rest.length === 1 ? nameOf(rest[0]!.id) : `${rest.length} others`, share: rest.reduce((t, r) => t + r.value, 0) / Math.max(1, total), change: null, value: rest.reduce((t, r) => t + r.value, 0) }] : []),
    ],
    platforms: sources.slice(0, 4).map((s) => ({
      id: s.id, name: nameOf(s.id), value: s.value, change: change(s.value, prev.get(s.id) ?? 0),
      line: dash.series.map((p) => Number(p.bySource[s.id] ?? 0)),
    })),
    chart: dash.series.map((p) => {
      const d = new Date(p.start);
      return { label: short.format(d), full: full.format(d), chip: dom.format(d), all: p.relevant ?? 0, negative: hourly ? null : negByDay.get(dayKey.format(d)) ?? 0 };
    }),
    hourly,
    week: week.map((w) => ({ d: w.d, share: w.classified > 0 ? w.negative / w.classified : null, classified: w.classified })),
    // Bugs first: the donut's red segment always means bugs, never just the largest kind.
    kinds: [...kindCount.entries()].sort((a, b) => Number(b[0] === "Bugs") - Number(a[0] === "Bugs") || b[1] - a[1]).map(([name, v]) => ({ name, v })),
    openIssues: open.length,
    flow: {
      from: flowFrom.map(([id, v]) => ({ id, name: nameOf(id), v })),
      to: [...topics.values()].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id)),
      links: links.sort((a, b) => ORDER.indexOf(a[1]) - ORDER.indexOf(b[1])),
    },
    heat,
    feed: ((feedRows ?? []) as Array<{ id: string; source: string; source_url: string; title: string | null; content: string | null; author_display: string | null; published_at: string; sentiment: string | null }>).map((m) => ({
      id: m.id, platform: nameOf(m.source), author: m.author_display, text: (m.title || m.content || m.source_url).replace(/\s+/g, " ").slice(0, 200),
      url: m.source_url, at: m.published_at, sentiment: m.sentiment,
    })),
  };

  return (
    <>
      {notice && <p role="status" className="mb-4 rounded-md border bg-muted px-3 py-2 text-[13px]">{notice}</p>}
      {product.onboardingStep < 6 && (
        <p className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[13px]">
          Setup isn&apos;t finished yet.<Button asChild size="sm"><Link href="/onboarding">Finish setup</Link></Button>
        </p>
      )}
      <OverviewBoard d={data} />
    </>
  );
}
