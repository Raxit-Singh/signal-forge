import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { BarChart3, ExternalLink, PackagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import { workspaceAvailability } from "@/lib/server/ai/gateway";
import { categoryLabel } from "@/lib/ai/cluster";
import type { PriorityResult } from "@/lib/ai/priority";
import type { FeedbackCategory } from "@/lib/ai/types";
import { isValidTimeZone } from "@/lib/analytics/buzz";
import { integrationInfo } from "@/lib/domain/integrations";
import { formatCount } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ai/action-form";
import { InvestigationResult, type InvestigationView } from "@/components/ai/investigation-result";
import { classifyNowAction, summarizeClusterAction } from "@/app/actions/ai";
import { setClusterStatusAction } from "@/app/actions/feedback";
import { AgentIssueControls } from "@/components/agent/issue-controls";
import { FeedbackTrendChart, SentimentChart, type FeedbackDay } from "./feedback-charts";

export const metadata: Metadata = { title: "Feedback Intelligence" };

const nameOf = (id: string) => integrationInfo(id as never)?.name.replace(/ \/ Stack Exchange$/, "") ?? id;
const PRIORITY_TONE = { critical: "negative", high: "negative", medium: "warning", low: "neutral" } as const;
const PRIORITIES = ["critical", "high", "medium", "low"] as const;
const STATUS_LABEL: Record<string, string> = { open: "Open", acknowledged: "Acknowledged", resolved: "Resolved", dismissed: "Dismissed" };
const TREND_LABEL: Record<string, string> = { new: "New this week", worsening: "Worsening", growing: "Growing", steady: "Steady", declining: "Declining" };
const AGENT_CATEGORIES = ["bug_report", "feature_request", "complaint", "usability_complaint", "performance_issue", "security_concern"];

type Cluster = {
  id: string; category: FeedbackCategory; title: string; report_count: number; unique_reporters: number | null;
  platforms: string[]; sentiment: string | null; suggested_priority: (typeof PRIORITIES)[number] | null; confidence: number | null;
  first_detected_at: string | null; last_detected_at: string | null; status: string; priority_score: number | null;
  priority_evidence: PriorityResult["evidence"] | null; algorithm: string;
};
type Member = { id: string; title: string | null; content: string | null; source: string; source_url: string; published_at: string; author_display: string | null };

function Bars({ items, label }: { items: Array<{ label: string; value: number }>; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.every((i) => i.value === 0)) return <p className="text-[13px] text-muted-foreground">Nothing classified in this period.</p>;
  return (
    <ul className="grid gap-2" aria-label={label}>
      {items.map((i) => (
        <li key={i.label} className="grid gap-1">
          <div className="flex justify-between gap-2 text-xs"><span className="truncate">{i.label}</span><span className="tabular text-muted-foreground">{formatCount(i.value)}</span></div>
          <div className="h-1.5 rounded bg-muted" aria-hidden><div className="h-1.5 rounded bg-[var(--feedback-feature)]" style={{ width: `${(i.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
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
  const showClosed = (await searchParams).status === "all";
  const cookieTz = (await cookies()).get("sf_tz")?.value;
  const tz = cookieTz && isValidTimeZone(cookieTz) ? cookieTz : "UTC";
  const supabase = await createClient();
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const head = () => supabase.from("mentions").select("id", { count: "exact", head: true }).eq("product_id", product.id).eq("dedup_kind", "original");

  const [ai, daysRes, waitingRes, testRes, clustersRes, invRes, sourcesRes, compRes, generalRes] = await Promise.all([
    workspaceAvailability(createAdminClient(), workspace.id),
    supabase.rpc("feedback_daily", { p_product_id: product.id, p_from: since, p_to: now.toISOString(), p_tz: tz }),
    head().eq("processing_status", "filtered").in("relevance_status", ["relevant", "pending", "user_relevant"]),
    head().eq("processing_status", "classified").like("ai_model", "test:%"),
    supabase.from("feedback_clusters")
      .select("id, category, title, report_count, unique_reporters, platforms, sentiment, suggested_priority, confidence, first_detected_at, last_detected_at, status, priority_score, priority_evidence, algorithm")
      .eq("product_id", product.id).in("status", showClosed ? ["open", "acknowledged", "resolved", "dismissed"] : ["open", "acknowledged"])
      .order("priority_score", { ascending: false, nullsFirst: false }).order("report_count", { ascending: false }).limit(50),
    supabase.from("ai_investigations").select("subject_key, status, report, error, model, completed_at").eq("product_id", product.id).eq("kind", "cluster_summary"),
    supabase.from("mentions").select("source").eq("product_id", product.id).eq("dedup_kind", "original").eq("processing_status", "classified")
      .neq("ai_about_product", "no").in("feedback_category", AGENT_CATEGORIES.concat(["pricing_complaint"]))
      .gte("published_at", since).limit(5000),
    head().eq("processing_status", "classified").eq("feedback_category", "competitor_comparison").gte("published_at", since),
    head().eq("processing_status", "classified").in("feedback_category", ["general_discussion", "other"]).gte("published_at", since),
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

  return (
    <>
      <PageHeader
        title="Feedback Intelligence"
        description={<>Bug reports, feature requests and complaints about {product.name}, grouped into prioritised issues with the posts behind them · last 30 days · days in {tz}</>}
      />
      <div className="grid gap-6">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 text-[13px]" data-testid="classification-status">
            {ai.ok
              ? <Badge tone={ai.kind === "test" ? "warning" : "positive"}>{ai.kind === "test" ? "Test classifier (not AI)" : "SignalForge Intelligence on"}</Badge>
              : <Badge tone="neutral">SignalForge Intelligence off</Badge>}
            <span><span className="font-medium tabular">{formatCount(classifiedTotal)}</span> mentions classified (last 30 days)</span>
            <span><span className="font-medium tabular">{formatCount(waitingRes.count ?? 0)}</span> waiting</span>
            {!ai.ok && <span className="text-muted-foreground">{ai.message} <Link href="/settings/ai" className="underline underline-offset-2">Details</Link></span>}
            {ai.ok && hasRole(workspace.role, "admin") && (waitingRes.count ?? 0) > 0 && (
              <ActionForm action={classifyNowAction} fields={{ workspaceId: workspace.id, productId: product.id }} label="Classify now" pendingLabel="Starting…" className="ml-auto" />
            )}
          </CardContent>
        </Card>

        <section aria-labelledby="fb-kpis" className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <h2 id="fb-kpis" className="sr-only">Feedback in numbers</h2>
          {([
            ["Actionable issues", open.length],
            ["Bug reports", sum("bugs")],
            ["Feature requests", sum("features")],
            ["Complaints", sum("complaints")],
            ["Positive feedback", sum("praise")],
          ] as const).map(([l, v]) => (
            <Card key={l} className="grid min-w-0 gap-0.5 p-3" data-testid="feedback-kpi">
              <span className="text-xs text-muted-foreground">{l}</span>
              <span className="text-xl font-semibold tabular">{formatCount(v)}</span>
            </Card>
          ))}
        </section>
        {(classifiedTotal > 0 || unclassifiedTotal > 0) && (
          <p className="-mt-3 text-xs text-muted-foreground">
            Counts are classified mentions only (issues: currently open or acknowledged). {formatCount(unclassifiedTotal)} mention{unclassifiedTotal === 1 ? "" : "s"} in this
            period {unclassifiedTotal === 1 ? "isn't" : "aren't"} classified yet; the charts show {unclassifiedTotal === 1 ? "it" : "them"} separately.
            {testLabels && " Includes test-classifier labels (keyword heuristic, not AI)."}
          </p>
        )}

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
                <CardDescription>Classified mentions per day.</CardDescription>
              </CardHeader>
              <CardContent><FeedbackTrendChart days={days as FeedbackDay[]} /></CardContent>
            </Card>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>Feedback categories</CardTitle></CardHeader>
            <CardContent>
              <Bars label="Feedback categories" items={[
                { label: "Bug reports", value: sum("bugs") }, { label: "Feature requests", value: sum("features") },
                { label: "Complaints", value: sum("complaints") }, { label: "Praise", value: sum("praise") },
                { label: "Questions", value: sum("questions") }, { label: "Competitor comparisons", value: compRes.count ?? 0 },
                { label: "General discussion / other", value: generalRes.count ?? 0 },
              ]} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Where feedback comes from</CardTitle><CardDescription>Bugs, requests and complaints by platform.</CardDescription></CardHeader>
            <CardContent>
              <Bars label="Platform distribution" items={[...platformCounts.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => ({ label: nameOf(p), value: n }))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Issue priority</CardTitle><CardDescription>Open and acknowledged issues.</CardDescription></CardHeader>
            <CardContent>
              <Bars label="Priority distribution" items={PRIORITIES.map((p) => ({ label: p[0]!.toUpperCase() + p.slice(1), value: open.filter((c) => c.suggested_priority === p).length }))} />
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
                        <li key={c.id} className="flex flex-wrap items-center gap-2">
                          <a href={`#issue-${c.id}`} className="underline-offset-2 hover:underline">{c.title}</a>
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

        <section aria-labelledby="issues" className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="issues" className="text-[15px] font-semibold">Issues</h2>
            <Link href={showClosed ? "/feedback" : "/feedback?status=all"} className="text-xs underline underline-offset-2">
              {showClosed ? "Hide resolved and dismissed" : "Show resolved and dismissed"}
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Posts describing the same problem or request are grouped, even when worded differently. An issue needs at least two
            independent reports: reposts, duplicates and repeat posts by the same author count once. Priority weighs severity,
            independent reporters (not raw mention count), trend, recurrence and confidence; each issue shows what was measured
            and what the AI inferred.
          </p>
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
                return (
                  <li key={c.id} id={`issue-${c.id}`}>
                    <Card className="grid gap-2 p-4 text-[13px]" data-testid="feedback-issue">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="info">{categoryLabel(c.category)}</Badge>
                        {c.suggested_priority && <Badge tone={PRIORITY_TONE[c.suggested_priority]}>Priority: {c.suggested_priority}</Badge>}
                        {ev && <Badge tone="neutral">{TREND_LABEL[ev.observed.trend]}</Badge>}
                        {c.status !== "open" && <Badge tone="neutral">{STATUS_LABEL[c.status]}</Badge>}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {c.algorithm === "semantic_v1" ? "Grouped by meaning" : "Grouped by wording"}
                          {c.confidence !== null && ` · confidence ${Math.round(c.confidence * 100)}%`}
                        </span>
                      </div>
                      <h3 className="font-medium">{c.title}</h3>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground tabular">{c.report_count}</span> independent report{c.report_count === 1 ? "" : "s"}
                        {c.unique_reporters !== null && ` · ${c.unique_reporters} reporter${c.unique_reporters === 1 ? "" : "s"}`}
                        {` · ${c.platforms.map(nameOf).join(", ")}`}
                        {c.first_detected_at && ` · first ${c.first_detected_at.slice(0, 10)}`}
                        {c.last_detected_at && `, latest ${c.last_detected_at.slice(0, 10)}`}
                        {c.sentiment && ` · mostly ${c.sentiment}`}
                      </p>
                      {ev && (
                        <details className="text-xs" data-testid="priority-evidence">
                          <summary className="cursor-pointer text-muted-foreground">Why this priority</summary>
                          <div className="mt-1 grid gap-2 sm:grid-cols-2">
                            <div>
                              <p className="font-medium">Observed in collected posts</p>
                              <ul className="list-disc pl-4 text-muted-foreground">
                                <li>{ev.observed.independent_reporters} independent reporters, {ev.observed.mentions} posts</li>
                                <li>{ev.observed.last_7_days} posts in the last 7 days, {ev.observed.previous_7_days} the week before</li>
                                <li>{ev.observed.recurring ? `Recurring: ${ev.observed.weeks_active} different weeks` : `Active in ${ev.observed.weeks_active} week${ev.observed.weeks_active === 1 ? "" : "s"}`}</li>
                                <li>{Math.round(ev.observed.negative_share * 100)}% of classified posts negative</li>
                              </ul>
                            </div>
                            <div>
                              <p className="font-medium">Inferred by AI{testLabels ? " (test classifier)" : ""}</p>
                              <ul className="list-disc pl-4 text-muted-foreground">
                                <li>Severity: {ev.inferred.severity}{ev.inferred.severity !== "unknown" && ` (${Object.entries(ev.inferred.severity_votes).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ")})`}</li>
                                {ev.inferred.area && <li>Affected area: {ev.inferred.area}</li>}
                                <li>Confidence: {Math.round(ev.inferred.confidence * 100)}%</li>
                              </ul>
                            </div>
                          </div>
                        </details>
                      )}
                      <ul className="grid gap-1 border-l-2 pl-3" aria-label="Supporting posts">
                        {members.slice(0, 3).map((m) => <Evidence key={m.id} m={m} />)}
                      </ul>
                      {members.length > 3 && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">All {members.length} posts</summary>
                          <ul className="mt-1 grid gap-1 border-l-2 pl-3">{members.slice(3).map((m) => <Evidence key={m.id} m={m} />)}</ul>
                        </details>
                      )}
                      {summary && <InvestigationResult inv={summary} />}
                      {canAct && (
                        <div className="flex flex-wrap items-center gap-1">
                          {(!summary || summary.status === "failed") && (
                            <ActionForm action={summarizeClusterAction} fields={{ workspaceId: workspace.id, clusterId: c.id, force: summary ? "true" : "false" }}
                              label={summary ? "Try summary again" : "Summarize"} pendingLabel="Requesting…" variant="ghost" />
                          )}
                          {(["acknowledged", "resolved", "dismissed", "open"] as const).filter((s) => s !== c.status).map((s) => (
                            <ActionForm key={s} action={setClusterStatusAction} fields={{ workspaceId: workspace.id, clusterId: c.id, status: s }}
                              label={s === "open" ? "Reopen" : s === "acknowledged" ? "Acknowledge" : s === "resolved" ? "Mark resolved" : "Dismiss"} variant="ghost" />
                          ))}
                        </div>
                      )}
                      {canAct && AGENT_CATEGORIES.includes(c.category) && <AgentIssueControls workspaceId={workspace.id} clusterId={c.id} />}
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

function Evidence({ m }: { m: Member }) {
  const text = (m.title || m.content || "").replace(/\s+/g, " ").slice(0, 180);
  return (
    <li className="grid gap-0.5 text-xs">
      <a href={m.source_url} target="_blank" rel="noreferrer noopener nofollow" className="inline-flex min-w-0 items-start gap-1 underline-offset-2 hover:underline">
        <span className="line-clamp-2">{text || "Untitled post"}</span><ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
      </a>
      <span className="text-muted-foreground">{nameOf(m.source)}{m.author_display ? ` · ${m.author_display}` : ""} · {m.published_at.slice(0, 10)}</span>
    </li>
  );
}
