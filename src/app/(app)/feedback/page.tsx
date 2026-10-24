import { feedbackMentionsHref, type RangeParams } from "@/lib/domain/feedback-filter";
import { parseRange } from "@/lib/domain/date-range";
import { getTimeZone } from "@/lib/server/timezone";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, BarChart3, PackagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import { workspaceAvailability } from "@/lib/server/ai/gateway";
import { categoryLabel } from "@/lib/ai/cluster";
import { formatCount } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ai/action-form";
import { StatusMenu } from "@/components/feedback/status-menu";
import { InvestigationResult, type InvestigationView } from "@/components/ai/investigation-result";
import { classifyNowAction, summarizeClusterAction } from "@/app/actions/ai";
import { AgentIssueControls } from "@/components/agent/issue-controls";
import { FeedbackTrendChart, SentimentChart, type FeedbackDay } from "./feedback-charts";
import {
  AGENT_CATEGORIES, CLUSTER_COLS, Evidence, IssueKind, PRIORITIES, PRIORITY_TONE, PriorityEvidence, STATUS_LABEL, TREND_LABEL, day, nameOf, type Cluster, type Member,
} from "@/components/feedback/issue-parts";

export const metadata: Metadata = { title: "Feedback Intelligence" };


function Bars({ items, label, hideZero = false, empty = "Nothing classified in this period." }: {
  items: Array<{ label: string; value: number; href?: string }>; label: string; hideZero?: boolean; empty?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.every((i) => i.value === 0)) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  if (hideZero) items = items.filter((i) => i.value > 0);
  return (
    <ul className="grid gap-2" aria-label={label}>
      {items.map((i) => (
        <li key={i.label} className="grid gap-1">
          <div className="flex justify-between gap-2 text-xs">
            {i.href && i.value > 0
              ? <Link href={i.href} className="truncate underline-offset-4 hover:underline">{i.label}</Link>
              : <span className="truncate">{i.label}</span>}
            <span className="tabular text-muted-foreground">{formatCount(i.value)}</span>
          </div>
          <div className="h-1.5 rounded bg-muted" aria-hidden><div className="h-1.5 rounded bg-[var(--feedback-feature)]" style={{ width: `${(i.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tz = await getTimeZone();
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  if (!product) {
    return (
      <>
        <PageHeader title="Feedback Intelligence" />
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

  const [ai, daysRes, waitingRes, testRes, clustersRes, invRes, sourcesRes, compRes, generalRes] = await Promise.all([
    workspaceAvailability(createAdminClient(), workspace.id),
    supabase.rpc("feedback_daily", { p_product_id: product.id, p_from: since, p_to: until, p_tz: tz }),
    head().eq("processing_status", "filtered").in("relevance_status", ["relevant", "pending", "user_relevant"]),
    head().eq("processing_status", "classified").like("ai_model", "test:%"),
    supabase.from("feedback_clusters")
      .select(CLUSTER_COLS)
      .eq("product_id", product.id).in("status", showClosed ? ["open", "acknowledged", "resolved", "dismissed"] : ["open", "acknowledged"])
      .order("priority_score", { ascending: false, nullsFirst: false }).order("report_count", { ascending: false }).limit(50),
    supabase.from("ai_investigations").select("subject_key, status, report, error, model, completed_at").eq("product_id", product.id).eq("kind", "cluster_summary"),
    supabase.from("mentions").select("source").eq("product_id", product.id).eq("dedup_kind", "original").eq("processing_status", "classified")
      .neq("ai_about_product", "no").in("feedback_category", AGENT_CATEGORIES.concat(["pricing_complaint"]))
      .gte("published_at", since).lt("published_at", until).limit(5000),
    head().eq("processing_status", "classified").eq("feedback_category", "competitor_comparison").gte("published_at", since).lt("published_at", until),
    head().eq("processing_status", "classified").in("feedback_category", ["general_discussion", "other"]).gte("published_at", since).lt("published_at", until),
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
  const platformCounts = new Map<string, number>();
  for (const r of sourcesRes.data ?? []) platformCounts.set(r.source as string, (platformCounts.get(r.source as string) ?? 0) + 1);
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

  const top = open.slice(0, 3);
  const kpis = [
    { label: "Open issues", value: open.length, unit: open.length === 1 ? "issue" : "issues", href: "#issues", cta: "See them ↓" },
    { label: "Bug reports", value: sum("bugs"), unit: "posts", href: mentionsHref("bugs"), cta: "Show them →" },
    { label: "Feature requests", value: sum("features"), unit: "posts", href: mentionsHref("features"), cta: "Show them →" },
    { label: "Complaints", value: sum("complaints"), unit: "posts", href: mentionsHref("complaints"), cta: "Show them →" },
    { label: "Praise", value: sum("praise"), unit: "posts", href: mentionsHref("praise"), cta: "Show them →" },
  ];

  return (
    <>
      <PageHeader
        title="Feedback Intelligence"
        description={<>Bug reports, feature requests and complaints about {product.name}, grouped into prioritised issues with the posts behind them · {period} · times in your time zone</>}
      />
      <div className="grid gap-6">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 text-[13px]" data-testid="classification-status">
            {ai.ok
              ? <Badge tone={ai.kind === "test" ? "warning" : "positive"}>{ai.kind === "test" ? "Test classifier (not AI)" : "SignalForge Intelligence on"}</Badge>
              : <Badge tone="neutral">SignalForge Intelligence off</Badge>}
            <span><span className="font-medium tabular">{formatCount(classifiedTotal)}</span> mentions classified ({period})</span>
            <span><span className="font-medium tabular">{formatCount(waitingRes.count ?? 0)}</span> waiting</span>
            {!ai.ok && <span className="text-muted-foreground">{ai.message} <Link href="/settings/ai" className="underline underline-offset-2">Details</Link></span>}
            {ai.ok && hasRole(workspace.role, "admin") && (waitingRes.count ?? 0) > 0 && (
              <ActionForm action={classifyNowAction} fields={{ workspaceId: workspace.id, productId: product.id }} label="Classify now" pendingLabel="Starting…" className="ml-auto" />
            )}
          </CardContent>
        </Card>

        {top.length > 0 && (
          <nav aria-labelledby="top-issues" className="grid gap-2 rounded-xl border bg-surface px-4 py-3 text-[13px]" data-testid="top-issues">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="top-issues" className="font-semibold">Top issues to look at</h2>
              <a href="#issues" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                All {open.length} open issue{open.length === 1 ? "" : "s"}<ArrowDown className="size-3" aria-hidden />
              </a>
            </div>
            <ol className="grid gap-1">
              {top.map((c) => (
                <li key={c.id}>
                  <a href={`#issue-${c.id}`} className="group flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1 py-1.5 hover:bg-muted/50 sm:min-h-0">
                    <IssueKind category={c.category} fallback={categoryLabel(c.category)} />
                    <span className="min-w-0 flex-1 font-medium group-hover:underline group-hover:underline-offset-2 max-sm:order-last max-sm:basis-full">{c.title}</span>
                    <span className="text-xs text-muted-foreground tabular">{c.report_count} report{c.report_count === 1 ? "" : "s"}</span>
                    {c.suggested_priority && <Badge tone={PRIORITY_TONE[c.suggested_priority]}>{c.suggested_priority[0]!.toUpperCase() + c.suggested_priority.slice(1)}</Badge>}
                    <ArrowDown className="size-3.5 text-muted-foreground" aria-hidden />
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <section aria-labelledby="fb-kpis" className="grid gap-2">
          <h2 id="fb-kpis" className="sr-only">Feedback in numbers</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {kpis.map((k) => (
              <Link key={k.label} href={k.href} className="group rounded-xl focus-visible:outline-2 focus-visible:outline-ring" aria-label={`${k.label}: ${k.value} ${k.unit}. ${k.cta.replace(/ [↓→]$/, "")}`}>
                <Card className="grid h-full min-w-0 gap-0.5 p-3 transition-colors group-hover:bg-muted/40" data-testid="feedback-kpi">
                  <span className="text-xs text-muted-foreground">{k.label}</span>
                  <span className="flex items-baseline gap-1">
                    <span className="text-xl font-semibold tabular">{formatCount(k.value)}</span>
                    <span className="text-xs text-muted-foreground">{k.unit}</span>
                  </span>
                  <span className="text-xs text-muted-foreground group-hover:text-foreground">{k.value > 0 ? k.cta : "None yet"}</span>
                </Card>
              </Link>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Issues group several posts about the same problem; post counts are classified posts {period}.
            {unclassifiedTotal > 0 && <> {formatCount(unclassifiedTotal)} post{unclassifiedTotal === 1 ? "" : "s"} {unclassifiedTotal === 1 ? "isn't" : "aren't"} classified yet; the charts show {unclassifiedTotal === 1 ? "it" : "them"} separately.</>}
            {testLabels && " Includes test-classifier labels (keyword heuristic, not AI)."}
          </p>
        </section>

        {days.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Sentiment toward {product.name}</CardTitle>
                <CardDescription>About the product itself, not a post&apos;s general tone. Posts judged not to be about {product.name} are left out.</CardDescription>
              </CardHeader>
              <CardContent><SentimentChart days={days as FeedbackDay[]} /></CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Bugs, feature requests and complaints</CardTitle>
                <CardDescription>Classified posts per day.</CardDescription>
              </CardHeader>
              <CardContent><FeedbackTrendChart days={days as FeedbackDay[]} /></CardContent>
            </Card>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>Feedback categories</CardTitle><CardDescription>Classified posts {period}.</CardDescription></CardHeader>
            <CardContent>
              <Bars label="Feedback categories" items={[
                { label: "Bug reports", value: sum("bugs"), href: mentionsHref("bugs") },
                { label: "Feature requests", value: sum("features"), href: mentionsHref("features") },
                { label: "Complaints", value: sum("complaints"), href: mentionsHref("complaints") },
                { label: "Praise", value: sum("praise"), href: mentionsHref("praise") },
                { label: "Questions", value: sum("questions"), href: mentionsHref("questions") },
                { label: "Competitor comparisons", value: compRes.count ?? 0, href: mentionsHref("comparisons") },
                { label: "General discussion / other", value: generalRes.count ?? 0, href: mentionsHref("general") },
              ]} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Where feedback comes from</CardTitle><CardDescription>Bug, request and complaint posts by platform.</CardDescription></CardHeader>
            <CardContent>
              <Bars label="Platform distribution" items={[...platformCounts.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => ({ label: nameOf(p), value: n }))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Issue priority</CardTitle><CardDescription>Open and acknowledged issues.</CardDescription></CardHeader>
            <CardContent>
              <Bars label="Priority distribution" hideZero empty="No open issues."
                items={PRIORITIES.map((p) => ({ label: p[0]!.toUpperCase() + p.slice(1), value: open.filter((c) => c.suggested_priority === p).length }))} />
            </CardContent>
          </Card>
        </div>

        {(trending.length > 0 || emerging.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {([["Trending issues", trending, "trending"], ["Recently emerging", emerging, "emerging"]] as const).map(([t, list, id]) => (
              <Card key={id}>
                <CardHeader><CardTitle>{t}</CardTitle></CardHeader>
                <CardContent>
                  {list.length === 0 ? <p className="text-[13px] text-muted-foreground">None right now.</p> : (
                    <ul className="grid gap-1.5 text-[13px]" data-testid={`issues-${id}`}>
                      {list.map((c) => (
                        <li key={c.id} className="grid gap-0.5">
                          <a href={`#issue-${c.id}`} className="inline-flex min-h-11 items-center gap-1 underline-offset-2 hover:underline sm:min-h-0">
                            {c.title}<ArrowDown className="size-3 shrink-0 text-muted-foreground" aria-label="(jump to issue)" />
                          </a>
                          <span className="text-xs text-muted-foreground">
                            {c.priority_evidence?.observed.last_7_days ?? 0} posts this week vs {c.priority_evidence?.observed.previous_7_days ?? 0} the week before
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <section aria-labelledby="issues" className="grid scroll-mt-20 gap-3" id="issues-section">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="issues" className="scroll-mt-20 text-[15px] font-semibold">Issues</h2>
            <Link href={issuesHref(!showClosed)} className="text-xs underline underline-offset-2">
              {showClosed ? "Hide resolved and dismissed" : "Show resolved and dismissed"}
            </Link>
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">{showClosed ? "All issues" : "Open and acknowledged issues"}, highest priority first · How issues are built and ranked</summary>
            <p className="mt-1 max-w-[75ch]">
              Posts describing the same problem or request are grouped, even when worded differently. An issue needs at least two
              independent reports: reposts, duplicates and repeat posts by the same author count once. Priority weighs severity,
              independent reporters (not raw post count), trend, recurrence and confidence; each issue shows what was measured
              and what the AI inferred. Issues are listed while they&apos;re open, whatever date range is selected.
            </p>
          </details>
          {clusters.length === 0 ? (
            <EmptyState icon={BarChart3} title="No grouped issues yet">
              {ai.ok
                ? "Issues appear once at least two people report the same thing. New mentions are classified every few minutes."
                : "Issues are built from classified mentions, which need SignalForge Intelligence."}
            </EmptyState>
          ) : (
            <ul className="grid gap-3" aria-label="Issues">
              {clusters.map((c) => {
                const members = membersOf(c.id);
                const summary = summaries.get(c.id);
                const ev = c.priority_evidence;
                const investigable = canAct && AGENT_CATEGORIES.includes(c.category);
                return (
                  <li key={c.id} id={`issue-${c.id}`} className="scroll-mt-20">
                    <Card className="grid gap-2 p-4 text-[13px]" data-testid="feedback-issue">
                      <div className="flex flex-wrap items-center gap-2">
                        <IssueKind category={c.category} fallback={categoryLabel(c.category)} />
                        {c.suggested_priority && <Badge tone={PRIORITY_TONE[c.suggested_priority]}>Priority: {c.suggested_priority}</Badge>}
                        {ev && <Badge tone="neutral">{TREND_LABEL[ev.observed.trend]}</Badge>}
                        {c.status !== "open" && <Badge tone="neutral">{STATUS_LABEL[c.status]}</Badge>}
                      </div>
                      <h3 className="text-[15px] font-medium leading-snug">{c.title}</h3>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground tabular">{c.report_count}</span> independent report{c.report_count === 1 ? "" : "s"}
                        {c.unique_reporters !== null && ` from ${c.unique_reporters} ${c.unique_reporters === 1 ? "person" : "people"}`}
                        {c.platforms.length > 0 && ` on ${c.platforms.map(nameOf).join(", ")}`}
                        {c.first_detected_at && ` · since ${day(c.first_detected_at, tz)}`}
                        {c.last_detected_at && `, latest ${day(c.last_detected_at, tz)}`}
                        {c.sentiment && ` · mostly ${c.sentiment}`}
                        {c.confidence !== null && ` · ${c.algorithm === "semantic_v1" ? "grouped by AI" : "grouped by matching words"}, ${Math.round(c.confidence * 100)}% sure`}
                      </p>
                      {ev && <PriorityEvidence ev={ev} testLabels={testLabels} />}
                      <ul className="grid gap-1 border-l pl-3" aria-label="Supporting posts">
                        {members.slice(0, 3).map((m) => <Evidence key={m.id} m={m} tz={tz} />)}
                      </ul>
                      {members.length > 3 && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">All {members.length} posts</summary>
                          <ul className="mt-1 grid gap-1 border-l pl-3">{members.slice(3).map((m) => <Evidence key={m.id} m={m} tz={tz} />)}</ul>
                        </details>
                      )}
                      {summary && <InvestigationResult inv={summary} />}
                      {canAct && (
                        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                          {investigable && <AgentIssueControls workspaceId={workspace.id} clusterId={c.id} primary />}
                          <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
                            {(!summary || summary.status === "failed") && (
                              <ActionForm action={summarizeClusterAction} fields={{ workspaceId: workspace.id, clusterId: c.id, force: summary ? "true" : "false" }}
                                label={summary ? "Try summary again" : "Summarize"} pendingLabel="Requesting…" variant="ghost" className="[&_button]:max-sm:min-h-11" />
                            )}
                            <StatusMenu workspaceId={workspace.id} clusterId={c.id} status={c.status} />
                          </div>
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
