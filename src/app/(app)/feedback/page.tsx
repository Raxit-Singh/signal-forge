import { FEEDBACK_FILTERS, feedbackMentionsHref, type RangeParams } from "@/lib/domain/feedback-filter";
import { parseRange } from "@/lib/domain/date-range";
import { getTimeZone } from "@/lib/server/timezone";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, BarChart3, Bug, PackagePlus, Sparkles } from "lucide-react";
import { CountUp } from "@/components/motion";
import { Periods } from "@/components/periods";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import { workspaceAvailability } from "@/lib/server/ai/gateway";
import { categoryLabel } from "@/lib/ai/cluster";
import { formatCount } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ai/action-form";
import { StatusMenu } from "@/components/feedback/status-menu";
import { InvestigationResult, type InvestigationView } from "@/components/ai/investigation-result";
import { classifyNowAction, summarizeClusterAction } from "@/app/actions/ai";
import { AgentIssueControls } from "@/components/agent/issue-controls";
import { FeedbackTrendChart, PlatformMatrix, SentimentChart, Spark, type FeedbackDay } from "./feedback-charts";
import {
  AGENT_CATEGORIES, CLUSTER_COLS, Evidence, IssueKind, PRIORITIES, PRIORITY_TONE, PriorityEvidence, STATUS_LABEL, TREND_LABEL, day, nameOf, type Cluster, type Member,
} from "@/components/feedback/issue-parts";

export const metadata: Metadata = { title: "Issues" };


const MATRIX_KINDS = ["bugs", "features", "complaints", "praise", "questions"] as const;
const KIND_SHORT: Record<(typeof MATRIX_KINDS)[number], string> = { bugs: "Bugs", features: "Requests", complaints: "Complaints", praise: "Praise", questions: "Questions" };

const PRIORITY_INK: Record<string, string> = {
  critical: "var(--signal)", high: "color-mix(in oklab, var(--signal) 55%, var(--foreground) 25%)",
  medium: "color-mix(in oklab, var(--foreground) 55%, transparent)", low: "color-mix(in oklab, var(--foreground) 22%, transparent)",
};

function Panel({ d, title, sub, children, className, action }: { d: number; title: string; sub?: React.ReactNode; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={`panel rise grid h-full content-start gap-4 rounded-[18px] p-5 ${className ?? ""}`} style={{ ["--d" as string]: `${d}ms` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-[13px] font-normal text-muted-foreground">{title}</h2>
          {sub && <p className="text-[12px] text-muted-foreground/80">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tz = await getTimeZone();
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  if (!product) {
    return (
      <>
        <PageHeader title="Issues" />
        <EmptyState icon={PackagePlus} title="Add a product first" action={{ href: "/onboarding/product", label: "Add product" }}>
          Feedback is grouped per product.
        </EmptyState>
      </>
    );
  }
  const sp = await searchParams;
  const showClosed = sp.status === "all";
  const supabase = await createClient();
  const now = new Date();
  // The top bar's date range: counts and charts cover it; issues are listed while open, whenever they started.
  const range = parseRange(sp, now);
  const since = range.from.toISOString();
  const until = range.to.toISOString();
  const rangeParams: RangeParams = { range: sp.range, from: sp.from, to: sp.to };
  const mentionsHref = (k: Parameters<typeof feedbackMentionsHref>[0]) => feedbackMentionsHref(k, rangeParams);
  const keep = new URLSearchParams(Object.entries(rangeParams).filter((e): e is [string, string] => !!e[1]));
  const issuesHref = (all: boolean) => { const q = new URLSearchParams(keep); if (all) q.set("status", "all"); const t = q.toString(); return `/feedback${t ? `?${t}` : ""}#issues`; };
  const period = range.label.toLowerCase();
  const head = () => supabase.from("mentions").select("id", { count: "exact", head: true }).eq("product_id", product.id).eq("dedup_kind", "original");

  const [ai, daysRes, waitingRes, testRes, clustersRes, invRes, sourcesRes] = await Promise.all([
    workspaceAvailability(createAdminClient(), workspace.id),
    supabase.rpc("feedback_daily", { p_product_id: product.id, p_from: since, p_to: until, p_tz: tz }),
    head().eq("processing_status", "filtered").in("relevance_status", ["relevant", "pending", "user_relevant"]),
    head().eq("processing_status", "classified").like("ai_model", "test:%"),
    supabase.from("feedback_clusters")
      .select(CLUSTER_COLS)
      .eq("product_id", product.id).in("status", showClosed ? ["open", "acknowledged", "resolved", "dismissed"] : ["open", "acknowledged"])
      .order("priority_score", { ascending: false, nullsFirst: false }).order("report_count", { ascending: false }).limit(50),
    supabase.from("ai_investigations").select("subject_key, status, report, error, model, completed_at").eq("product_id", product.id).eq("kind", "cluster_summary"),
    supabase.from("mentions").select("source, feedback_category").eq("product_id", product.id).eq("dedup_kind", "original").eq("processing_status", "classified")
      // "not judged off-topic": a plain neq would also drop posts the AI hasn't judged (NULL).
      .or("ai_about_product.is.null,ai_about_product.neq.no").in("feedback_category", MATRIX_KINDS.flatMap((k) => [...FEEDBACK_FILTERS[k].categories]))
      .gte("published_at", since).lt("published_at", until).limit(5000),
  ]);
  const days = ((daysRes.data ?? []) as Array<Record<string, number | string>>).map((d) => ({
    day: String(d.day), classified: Number(d.classified), unclassified: Number(d.unclassified), positive: Number(d.positive),
    negative: Number(d.negative), neutral: Number(d.neutral), mixed: Number(d.mixed), uncertain: Number(d.uncertain),
    bugs: Number(d.bugs), features: Number(d.features), complaints: Number(d.complaints), praise: Number(d.praise), questions: Number(d.questions),
  }));
  const sum = (k: keyof (typeof days)[number]) => days.reduce((a, d) => a + Number(d[k]), 0);
  const clusters = (clustersRes.data ?? []) as Cluster[];
  const open = clusters.filter((c) => c.status === "open" || c.status === "acknowledged");
  const summaries = new Map((invRes.data ?? []).map((i) => [i.subject_key as string, i as unknown as InvestigationView]));
  const testLabels = (testRes.count ?? 0) > 0;
  const canAct = hasRole(workspace.role, "member");
  // Platform × kind of feedback, for the matrix (kinds as on the Mentions filter, so links match).
  const kindOf = new Map(MATRIX_KINDS.flatMap((k) => FEEDBACK_FILTERS[k].categories.map((c) => [c as string, k])));
  const matrix = new Map<string, Record<string, number>>();
  for (const r of (sourcesRes.data ?? []) as Array<{ source: string; feedback_category: string }>) {
    const k = kindOf.get(r.feedback_category);
    if (!k) continue;
    const row = matrix.get(r.source) ?? {};
    row[k] = (row[k] ?? 0) + 1;
    matrix.set(r.source, row);
  }
  const platformRows = [...matrix.entries()]
    .map(([id, counts]) => ({ id, name: nameOf(id), counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total).slice(0, 10);
  const rangeQuery = new URLSearchParams(Object.entries(rangeParams).filter((e): e is [string, string] => !!e[1])).toString();
  const trending = open.filter((c) => ["worsening", "growing"].includes(c.priority_evidence?.observed.trend ?? "")).slice(0, 5);
  const emerging = open.filter((c) => c.priority_evidence?.observed.trend === "new").slice(0, 5);

  // Evidence for each issue (members, newest first).
  const ids = clusters.map((c) => c.id);
  const { data: memberRows } = ids.length
    ? await supabase.from("feedback_cluster_members").select("cluster_id, mention_id").in("cluster_id", ids).limit(2000)
    : { data: [] };
  const mentionIds = [...new Set((memberRows ?? []).map((m) => m.mention_id as string))];
  const { data: mentionRows } = mentionIds.length
    ? await supabase.from("mentions").select("id, title, content, source, source_url, published_at, author_display").in("id", mentionIds)
    : { data: [] };
  const mentionById = new Map(((mentionRows ?? []) as Member[]).map((m) => [m.id, m]));
  const membersOf = (clusterId: string) => (memberRows ?? []).filter((m) => m.cluster_id === clusterId)
    .map((m) => mentionById.get(m.mention_id as string)).filter((m): m is Member => !!m)
    .sort((a, b) => b.published_at.localeCompare(a.published_at));

  const classifiedTotal = sum("classified");
  const unclassifiedTotal = sum("unclassified");

  const series = (k: "bugs" | "features" | "complaints" | "praise") => days.map((d) => Number(d[k]));
  const kpis = [
    { label: "Open issues", value: open.length, unit: open.length === 1 ? "issue" : "issues", href: "#issues", cta: "See them ↓", line: null as number[] | null, red: false },
    { label: "Bug reports", value: sum("bugs"), unit: "posts", href: mentionsHref("bugs"), cta: "Show them →", line: series("bugs"), red: true },
    { label: "Feature requests", value: sum("features"), unit: "posts", href: mentionsHref("features"), cta: "Show them →", line: series("features"), red: false },
    { label: "Complaints", value: sum("complaints"), unit: "posts", href: mentionsHref("complaints"), cta: "Show them →", line: series("complaints"), red: false },
    { label: "Praise", value: sum("praise"), unit: "posts", href: mentionsHref("praise"), cta: "Show them →", line: series("praise"), red: false },
  ];
  const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, open.filter((c) => c.suggested_priority === p).length])) as Record<(typeof PRIORITIES)[number], number>;
  const worsening = open.filter((c) => ["worsening", "growing"].includes(c.priority_evidence?.observed.trend ?? "")).length;
  const topIssue = open[0];
  const ring = 2 * Math.PI * 62;
  const ranked = PRIORITIES.filter((p) => byPriority[p] > 0);
  const urgent = open.filter((c) => c.suggested_priority === "critical" || c.suggested_priority === "high").slice(0, 3);
  const unranked = open.length - PRIORITIES.reduce((t, p) => t + byPriority[p], 0);
  const starts = ranked.map((_, i) => ranked.slice(0, i).reduce((t, p) => t + (byPriority[p] / Math.max(1, open.length)) * ring, 0));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 pb-10">
      {/* Hero: what's open, how urgent, and how feedback moves day by day. */}
      <section className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="rise grid content-start gap-5">
          <div className="grid gap-1.5">
            <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">Issues</h1>
            <p className="max-w-[60ch] text-[14px] text-muted-foreground">Bug reports, feature requests and complaints about {product.name}, grouped into prioritised issues with the posts behind them · {period}</p>
          </div>
          <div className="grid gap-2">
            <div className="flex items-baseline gap-3">
              <CountUp value={open.length} className="text-[56px] font-semibold leading-none tracking-[-0.045em] sm:text-[64px]" />
              <span className="text-[15px] text-muted-foreground">open {open.length === 1 ? "issue" : "issues"}</span>
            </div>
            <p className="text-[14px] text-muted-foreground">
              <span className={byPriority.critical > 0 ? "text-signal" : undefined}>{byPriority.critical} critical</span> · {byPriority.high} high · {worsening} getting worse
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {topIssue && (
              <a href={`#issue-${topIssue.id}`} title={topIssue.title}
                className="press flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_8px_24px_-8px_color-mix(in_oklab,var(--signal)_80%,transparent)]">
                <Sparkles className="size-4" aria-hidden />Open top issue
              </a>
            )}
            <Link href={mentionsHref("bugs")} className="press panel flex h-11 items-center gap-2 rounded-full px-5 text-[14px] transition-colors hover:bg-foreground/[0.06]">
              <Bug className="size-4" aria-hidden />Bug reports
            </Link>
          </div>
          <div className="panel flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-3 text-[13px]" data-testid="classification-status">
            <span className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${ai.ok ? (ai.kind === "test" ? "bg-warning" : "bg-positive") : "bg-muted-foreground"}`} aria-hidden />
              {ai.ok ? (ai.kind === "test" ? "Test classifier (not AI)" : "SignalForge Intelligence on") : "SignalForge Intelligence off"}
            </span>
            <span className="text-muted-foreground"><span className="font-medium text-foreground tabular">{formatCount(classifiedTotal)}</span> classified</span>
            <span className="text-muted-foreground"><span className="font-medium text-foreground tabular">{formatCount(waitingRes.count ?? 0)}</span> waiting</span>
            {!ai.ok && <span className="text-muted-foreground">{ai.message} <Link href="/settings/ai" className="underline underline-offset-2">Details</Link></span>}
            {ai.ok && hasRole(workspace.role, "admin") && (waitingRes.count ?? 0) > 0 && (
              <ActionForm action={classifyNowAction} fields={{ workspaceId: workspace.id, productId: product.id }} label="Classify now" pendingLabel="Starting…" className="ml-auto" />
            )}
          </div>
        </div>
        <div className="rise grid content-between gap-5" style={{ ["--d" as string]: "120ms" }}>
          <div className="flex justify-end"><Periods value={range.custom ? "custom" : range.key} /></div>
          {days.length > 0
            ? <FeedbackTrendChart days={days as FeedbackDay[]} />
            : <p className="grid h-[170px] place-content-center rounded-2xl border border-dashed text-[13px] text-muted-foreground">Nothing classified in this period yet.</p>}
        </div>
      </section>

      {/* Feedback in numbers: each card opens the posts behind it. */}
      <section aria-labelledby="fb-kpis" className="grid gap-2">
        <h2 id="fb-kpis" className="sr-only">Feedback in numbers</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {kpis.map((k, i) => (
            <Link key={k.label} href={k.href} aria-label={`${k.label}: ${k.value} ${k.unit}. ${k.cta.replace(/ [↓→]$/, "")}`}
              className="panel lift press rise grid gap-3 rounded-[18px] p-4" style={{ ["--d" as string]: `${180 + i * 60}ms` }} data-testid="feedback-kpi">
              <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                {k.red && <span className="size-1.5 rounded-full bg-signal shadow-[var(--signal-glow)]" aria-hidden />}{k.label}
              </span>
              <span className="flex items-end justify-between gap-2">
                <span className="grid gap-0.5">
                  <CountUp value={k.value} className="text-[24px] font-semibold leading-none tracking-[-0.03em]" />
                  <span className="text-[12px] text-muted-foreground/80">{k.value > 0 ? k.cta : "None yet"}</span>
                </span>
                {k.line ? <Spark values={k.line} red={k.red} /> : (
                  <span className="flex h-9 items-end gap-1" aria-hidden>
                    {PRIORITIES.map((p) => (
                      <span key={p} className="w-2.5 rounded-full" style={{ height: `${Math.max(12, (byPriority[p] / Math.max(1, open.length)) * 100)}%`, background: PRIORITY_INK[p] }} />
                    ))}
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>
        <p className="px-1 text-[12px] text-muted-foreground/80">
          Issues group several posts about the same problem; post counts are classified posts {period}.
          {unclassifiedTotal > 0 && <> {formatCount(unclassifiedTotal)} post{unclassifiedTotal === 1 ? "" : "s"} {unclassifiedTotal === 1 ? "isn't" : "aren't"} classified yet; the charts show {unclassifiedTotal === 1 ? "it" : "them"} separately.</>}
          {testLabels && " Includes test-classifier labels (keyword heuristic, not AI)."}
        </p>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-12">
        <Panel d={300} className="xl:col-span-7" title={`Sentiment toward ${product.name}`}
          sub={<>About the product itself, not a post&apos;s general tone. Posts judged not to be about {product.name} are left out.</>}>
          {days.length > 0 ? <SentimentChart days={days as FeedbackDay[]} /> : <p className="text-[13px] text-muted-foreground">Nothing classified in this period yet.</p>}
        </Panel>
        <Panel d={360} className="xl:col-span-5" title="Issue priority" sub="Open and acknowledged issues.">
          {open.length === 0 ? <p className="grid min-h-40 place-content-center rounded-xl border border-dashed text-[13px] text-muted-foreground">No open issues.</p> : (
            <div className="grid content-between gap-5">
              <div className="grid items-center gap-6 sm:grid-cols-[200px_minmax(0,1fr)]">
                <div className="relative mx-auto size-[200px]">
                  <svg viewBox="0 0 160 160" className="size-full -rotate-90" aria-hidden>
                    <circle cx="80" cy="80" r="62" fill="none" stroke="color-mix(in oklab, var(--foreground) 7%, transparent)" strokeWidth="14" />
                    {ranked.map((p, i) => (
                      <circle key={p} cx="80" cy="80" r="62" fill="none" stroke={PRIORITY_INK[p]} strokeWidth="14" strokeLinecap={ranked.length > 1 ? "round" : "butt"}
                        strokeDasharray={`${Math.max(0.5, (byPriority[p] / open.length) * ring - (ranked.length > 1 || unranked > 0 ? 10 : 0))} ${ring}`} strokeDashoffset={-starts[i]!}
                        className="fade-in" style={{ ["--d" as string]: `${600 + i * 120}ms`, filter: p === "critical" ? "drop-shadow(0 0 8px color-mix(in oklab, var(--signal) 60%, transparent))" : undefined }} />
                    ))}
                  </svg>
                  <div className="absolute inset-0 grid place-content-center text-center">
                    <CountUp value={open.length} className="text-[40px] font-semibold leading-none tracking-[-0.04em]" />
                    <span className="mt-1 text-[12px] text-muted-foreground/80">open issues</span>
                  </div>
                </div>
                <ul className="grid gap-3.5 text-[13px]" aria-label="Priority distribution">
                  {PRIORITIES.map((p) => (
                    <li key={p} className="grid gap-1.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="flex items-center gap-2 capitalize text-foreground/90">
                          <span className="size-2 rounded-full" style={{ background: PRIORITY_INK[p], boxShadow: p === "critical" ? "var(--signal-glow)" : undefined }} aria-hidden />{p}
                        </span>
                        <span className="tabular-nums"><span className="font-semibold">{byPriority[p]}</span><span className="ml-1.5 text-[11px] text-muted-foreground">{Math.round((byPriority[p] / open.length) * 100)}%</span></span>
                      </span>
                      <span className="block h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]" aria-hidden>
                        <span className="grow-x block h-full rounded-full" style={{ width: `${(byPriority[p] / open.length) * 100}%`, background: PRIORITY_INK[p] }} />
                      </span>
                    </li>
                  ))}
                  {unranked > 0 && (
                    <li className="flex items-baseline justify-between gap-2 text-muted-foreground">
                      <span>Not ranked yet</span><span className="tabular-nums">{unranked}</span>
                    </li>
                  )}
                </ul>
              </div>
              {urgent.length > 0 && (
                <div className="grid gap-1.5 border-t border-foreground/[0.06] pt-4">
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">Most urgent</h3>
                  <ul className="grid gap-1">
                    {urgent.map((c) => (
                      <li key={c.id}>
                        <a href={`#issue-${c.id}`} className="group flex items-center gap-3 rounded-xl px-2 py-2 text-[13px] transition-colors hover:bg-foreground/[0.04]">
                          <span className="size-2 shrink-0 rounded-full" style={{ background: PRIORITY_INK[c.suggested_priority ?? "low"], boxShadow: c.suggested_priority === "critical" ? "var(--signal-glow)" : undefined }} aria-hidden />
                          <span className="min-w-0 flex-1 truncate group-hover:underline group-hover:underline-offset-2">{c.title}</span>
                          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{c.unique_reporters ?? c.report_count} {(c.unique_reporters ?? c.report_count) === 1 ? "person" : "people"}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-12">
        <Panel d={420} className="md:col-span-2 xl:col-span-8" title="Feedback by platform"
          sub={<>Which platforms bring bugs, requests, complaints, praise and questions · {period}. Pick a kind to rank platforms; every mark opens those posts.</>}>
          <PlatformMatrix rows={platformRows} query={rangeQuery} kinds={MATRIX_KINDS.map((k) => ({ key: k, label: FEEDBACK_FILTERS[k].label, short: KIND_SHORT[k] }))} />
        </Panel>
        <Panel d={540} className="md:col-span-2 xl:col-span-4" title="Moving now" sub="Issues growing this week, and ones that just appeared.">
          {trending.length === 0 && emerging.length === 0 ? (
            <p className="grid min-h-32 place-content-center rounded-xl border border-dashed px-4 text-center text-[13px] text-muted-foreground">Nothing is growing or new right now.</p>
          ) : (
            <div className="grid gap-4">
              {([["Trending issues", trending, "trending"], ["Recently emerging", emerging, "emerging"]] as const).filter(([, list]) => list.length > 0).map(([t, list, id]) => (
                <div key={id} className="grid gap-2">
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">{t}</h3>
                  <ul className="grid gap-1.5 text-[13px]" data-testid={`issues-${id}`}>
                    {list.map((c) => (
                      <li key={c.id}>
                        <a href={`#issue-${c.id}`} className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-foreground/[0.04]">
                          <span className={`size-2 shrink-0 rounded-full ${id === "trending" ? "bg-signal shadow-[var(--signal-glow)]" : "bg-foreground/60"}`} aria-hidden />
                          <span className="grid min-w-0 flex-1">
                            <span className="truncate group-hover:underline group-hover:underline-offset-2">{c.title}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {c.priority_evidence?.observed.last_7_days ?? 0} posts this week vs {c.priority_evidence?.observed.previous_7_days ?? 0} the week before
                            </span>
                          </span>
                          <ArrowDown className="size-3.5 shrink-0 text-muted-foreground" aria-label="(jump to issue)" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <section aria-labelledby="issues" className="grid scroll-mt-20 gap-3 pt-2" id="issues-section">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h2 id="issues" className="scroll-mt-20 text-[24px] font-medium tracking-[-0.03em]">{showClosed ? "All issues" : "Open issues"}</h2>
            <details className="text-[12px] text-muted-foreground">
              <summary className="cursor-pointer">Highest priority first · How issues are built and ranked</summary>
              <p className="mt-1 max-w-[75ch]">
                Posts describing the same problem or request are grouped, even when worded differently. An issue needs at least two
                independent reports: reposts, duplicates and repeat posts by the same author count once. Priority weighs severity,
                independent reporters (not raw post count), trend, recurrence and confidence; each issue shows what was measured
                and what the AI inferred. Issues are listed while they&apos;re open, whatever date range is selected.
              </p>
            </details>
          </div>
          <Link href={issuesHref(!showClosed)} className="press panel inline-flex h-9 items-center rounded-full px-4 text-[13px] transition-colors hover:bg-foreground/[0.06]">
            {showClosed ? "Hide resolved and dismissed" : "Show resolved and dismissed"}
          </Link>
        </div>
        {clusters.length === 0 ? (
          <EmptyState icon={BarChart3} title="No grouped issues yet">
            {ai.ok
              ? "Issues appear once at least two people report the same thing. New mentions are classified every few minutes."
              : "Issues are built from classified mentions, which need SignalForge Intelligence."}
          </EmptyState>
        ) : (
          <ul className="grid gap-3" aria-label="Issues">
            {clusters.map((c, i) => {
              const members = membersOf(c.id);
              const summary = summaries.get(c.id);
              const ev = c.priority_evidence;
              const investigable = canAct && AGENT_CATEGORIES.includes(c.category);
              const hot = c.suggested_priority === "critical" || c.suggested_priority === "high";
              return (
                <li key={c.id} id={`issue-${c.id}`} className="scroll-mt-20">
                  <article className={`panel rise relative grid gap-4 overflow-hidden rounded-[18px] p-5 text-[13px] sm:p-6 ${hot ? "border-signal/25" : ""}`}
                    style={{ ["--d" as string]: `${Math.min(i, 8) * 50}ms` }} data-testid="feedback-issue">
                    {hot && <span className="pointer-events-none absolute -left-20 -top-20 size-48 rounded-full bg-signal/15 blur-3xl" aria-hidden />}
                    {c.suggested_priority && <span className="absolute inset-y-6 left-0 w-[3px] rounded-r-full" style={{ background: PRIORITY_INK[c.suggested_priority], boxShadow: hot ? "var(--signal-glow)" : undefined }} aria-hidden />}

                    <div className="relative flex flex-wrap items-start gap-4">
                      <div className="grid min-w-0 flex-1 gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <IssueKind category={c.category} fallback={categoryLabel(c.category)} />
                          {c.suggested_priority && <Badge tone={PRIORITY_TONE[c.suggested_priority]}>Priority: {c.suggested_priority}</Badge>}
                          {ev && <Badge tone="neutral">{TREND_LABEL[ev.observed.trend]}</Badge>}
                          {c.status !== "open" && <Badge tone="neutral">{STATUS_LABEL[c.status]}</Badge>}
                        </div>
                        <h3 className="text-[19px] font-medium leading-snug tracking-[-0.015em]">{c.title}</h3>
                      </div>
                      <div className="grid shrink-0 justify-items-end gap-0.5 text-right">
                        <span className={`text-[34px] font-semibold leading-none tracking-[-0.04em] tabular ${hot ? "text-signal" : ""}`}>{c.unique_reporters ?? c.report_count}</span>
                        <span className="text-[11px] text-muted-foreground">{(c.unique_reporters ?? c.report_count) === 1 ? "person" : "people"}</span>
                      </div>
                    </div>

                    <p className="relative text-[12px] text-muted-foreground">
                      <span className="font-medium text-foreground tabular">{c.report_count}</span> independent report{c.report_count === 1 ? "" : "s"}
                      {c.unique_reporters !== null && ` from ${c.unique_reporters} ${c.unique_reporters === 1 ? "person" : "people"}`}
                      {c.platforms.length > 0 && ` on ${c.platforms.map(nameOf).join(", ")}`}
                      {c.first_detected_at && ` · since ${day(c.first_detected_at, tz)}`}
                      {c.last_detected_at && `, latest ${day(c.last_detected_at, tz)}`}
                      {c.sentiment && ` · mostly ${c.sentiment}`}
                      {c.confidence !== null && ` · ${c.algorithm === "semantic_v1" ? "grouped by AI" : "grouped by matching words"}, ${Math.round(c.confidence * 100)}% sure`}
                    </p>

                    {members.length > 0 && (
                      <ul className="relative grid gap-2 sm:grid-cols-3" aria-label="Supporting posts">
                        {members.slice(0, 3).map((m) => <Evidence key={m.id} m={m} tz={tz} />)}
                      </ul>
                    )}
                    {members.length > 3 && (
                      <details className="relative text-[12px]">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">All {members.length} posts</summary>
                        <ul className="mt-2 grid gap-2 sm:grid-cols-3">{members.slice(3).map((m) => <Evidence key={m.id} m={m} tz={tz} />)}</ul>
                      </details>
                    )}
                    {ev && <div className="relative"><PriorityEvidence ev={ev} testLabels={testLabels} /></div>}
                    {summary && <div className="relative"><InvestigationResult inv={summary} /></div>}
                    {canAct && (
                      <div className="relative flex flex-wrap items-center gap-2 border-t border-foreground/[0.06] pt-4">
                        {investigable && <AgentIssueControls workspaceId={workspace.id} clusterId={c.id} primary={i === 0} />}
                        <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
                          {(!summary || summary.status === "failed") && (
                            <ActionForm action={summarizeClusterAction} fields={{ workspaceId: workspace.id, clusterId: c.id, force: summary ? "true" : "false" }}
                              label={summary ? "Try summary again" : "Summarize"} pendingLabel="Requesting…" variant="ghost" className="[&_button]:max-sm:min-h-11" />
                          )}
                          <StatusMenu workspaceId={workspace.id} clusterId={c.id} status={c.status} />
                        </div>
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
