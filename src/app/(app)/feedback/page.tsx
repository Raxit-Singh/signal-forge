import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, ExternalLink, PackagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import { workspaceAvailability } from "@/lib/server/ai/gateway";
import { categoryLabel } from "@/lib/ai/cluster";
import type { FeedbackCategory } from "@/lib/ai/types";
import { integrationInfo } from "@/lib/domain/integrations";
import { formatCount } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ai/action-form";
import { InvestigationResult, type InvestigationView } from "@/components/ai/investigation-result";
import { classifyNowAction, summarizeClusterAction } from "@/app/actions/ai";
import { setClusterStatusAction } from "@/app/actions/feedback";

export const metadata: Metadata = { title: "Feedback Intelligence" };

const nameOf = (id: string) => integrationInfo(id as never)?.name.replace(/ \/ Stack Exchange$/, "") ?? id;
const SENTIMENT_ORDER = ["negative", "mixed", "neutral", "positive", "uncertain"] as const;
const SENTIMENT_COLOR: Record<string, string> = {
  negative: "var(--negative)", mixed: "var(--warning)", neutral: "var(--muted-foreground)", positive: "var(--positive)", uncertain: "var(--border)",
};
const PRIORITY_TONE = { critical: "negative", high: "negative", medium: "warning", low: "neutral" } as const;
const STATUS_LABEL: Record<string, string> = { open: "Open", acknowledged: "Acknowledged", resolved: "Resolved", dismissed: "Dismissed" };

type Cluster = {
  id: string; category: FeedbackCategory; title: string; report_count: number; unique_reporters: number | null;
  platforms: string[]; sentiment: string | null; suggested_priority: keyof typeof PRIORITY_TONE | null; confidence: number | null;
  first_detected_at: string | null; last_detected_at: string | null; status: string;
};
type Member = { id: string; title: string | null; content: string | null; source: string; source_url: string; published_at: string; author_display: string | null };

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
  const supabase = await createClient();
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const base = () => supabase.from("mentions").select("id", { count: "exact", head: true }).eq("product_id", product.id).eq("dedup_kind", "original");

  const [ai, classifiedRes, waitingRes, testRes, clustersRes, invRes, ...sentimentRes] = await Promise.all([
    workspaceAvailability(createAdminClient(), workspace.id),
    base().eq("processing_status", "classified").gte("published_at", since),
    base().eq("processing_status", "filtered").in("relevance_status", ["relevant", "pending", "user_relevant"]),
    base().eq("processing_status", "classified").like("ai_model", "test:%"),
    supabase.from("feedback_clusters")
      .select("id, category, title, report_count, unique_reporters, platforms, sentiment, suggested_priority, confidence, first_detected_at, last_detected_at, status")
      .eq("product_id", product.id).in("status", showClosed ? ["open", "acknowledged", "resolved", "dismissed"] : ["open", "acknowledged"])
      .order("report_count", { ascending: false }).order("last_detected_at", { ascending: false }).limit(50),
    supabase.from("ai_investigations").select("subject_key, status, report, error, model, completed_at").eq("product_id", product.id).eq("kind", "cluster_summary"),
    ...SENTIMENT_ORDER.map((s) => base().eq("processing_status", "classified").gte("published_at", since).eq("sentiment", s).neq("ai_about_product", "no")),
  ]);
  const clusters = (clustersRes.data ?? []) as Cluster[];
  const summaries = new Map((invRes.data ?? []).map((i) => [i.subject_key as string, i as unknown as InvestigationView]));
  const testLabels = (testRes.count ?? 0) > 0;
  const canAct = hasRole(workspace.role, "member");

  // Evidence for each issue (members, newest first).
  const ids = clusters.map((c) => c.id);
  const { data: memberRows } = ids.length
    ? await supabase.from("feedback_cluster_members").select("cluster_id, mention_id, similarity").in("cluster_id", ids).limit(2000)
    : { data: [] };
  const mentionIds = [...new Set((memberRows ?? []).map((m) => m.mention_id as string))];
  const { data: mentionRows } = mentionIds.length
    ? await supabase.from("mentions").select("id, title, content, source, source_url, published_at, author_display").in("id", mentionIds)
    : { data: [] };
  const mentionById = new Map(((mentionRows ?? []) as Member[]).map((m) => [m.id, m]));
  const membersOf = (clusterId: string) => (memberRows ?? []).filter((m) => m.cluster_id === clusterId)
    .map((m) => mentionById.get(m.mention_id as string)).filter((m): m is Member => !!m)
    .sort((a, b) => b.published_at.localeCompare(a.published_at));

  const sentiments = SENTIMENT_ORDER.map((s, i) => ({ label: s, value: sentimentRes[i]?.count ?? 0 }));
  const sentimentTotal = sentiments.reduce((a, s) => a + s.value, 0);

  return (
    <>
      <PageHeader
        title="Feedback Intelligence"
        description={<>Bug reports, feature requests and complaints about {product.name}, grouped into issues with the posts behind them.</>}
      />
      <div className="grid gap-6">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 text-[13px]" data-testid="classification-status">
            {ai.ok
              ? <Badge tone={ai.kind === "test" ? "warning" : "positive"}>{ai.kind === "test" ? "Test classifier (not AI)" : "AI classification on"}</Badge>
              : <Badge tone="neutral">AI classification off</Badge>}
            <span><span className="font-medium tabular">{formatCount(classifiedRes.count ?? 0)}</span> mentions classified (last 30 days)</span>
            <span><span className="font-medium tabular">{formatCount(waitingRes.count ?? 0)}</span> waiting</span>
            {!ai.ok && <span className="text-muted-foreground">{ai.message} <Link href="/settings/ai" className="underline underline-offset-2">AI settings</Link></span>}
            {ai.ok && hasRole(workspace.role, "admin") && (waitingRes.count ?? 0) > 0 && (
              <ActionForm action={classifyNowAction} fields={{ workspaceId: workspace.id, productId: product.id }} label="Classify now" pendingLabel="Starting…" className="ml-auto" />
            )}
          </CardContent>
        </Card>

        {sentimentTotal > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Sentiment toward {product.name} · last 30 days</CardTitle>
              <CardDescription>
                Sentiment about the product itself, not the general tone of a post. Low-confidence labels count as uncertain; posts the
                classifier judged not to be about {product.name} are left out.{testLabels && " Includes test-classifier labels (keyword heuristic, not AI)."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex h-2 overflow-hidden rounded" aria-hidden>
                {sentiments.filter((s) => s.value > 0).map((s) => (
                  <div key={s.label} style={{ width: `${(s.value / sentimentTotal) * 100}%`, background: SENTIMENT_COLOR[s.label] }} />
                ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Sentiment breakdown">
                {sentiments.map((s) => (
                  <li key={s.label}><span className="capitalize">{s.label}</span> <span className="tabular text-muted-foreground">{formatCount(s.value)} · {Math.round((s.value / sentimentTotal) * 100)}%</span></li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <section aria-labelledby="issues" className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="issues" className="text-[15px] font-semibold">Issues</h2>
            <Link href={showClosed ? "/feedback" : "/feedback?status=all"} className="text-xs underline underline-offset-2">
              {showClosed ? "Hide resolved and dismissed" : "Show resolved and dismissed"}
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Related posts grouped by category and wording (not by a model). An issue needs at least two independent reports: reposts,
            duplicates and repeat posts by the same author count once. Priority is a suggestion from report count, category and sentiment.
          </p>
          {clusters.length === 0 ? (
            <EmptyState icon={BarChart3} title="No grouped issues yet">
              {ai.ok
                ? "Issues appear once at least two people report the same thing. New mentions are classified every few minutes."
                : "Issues are built from classified mentions. Turn on AI classification in AI settings to start."}
            </EmptyState>
          ) : (
            <ul className="grid gap-3" aria-label="Issues">
              {clusters.map((c) => {
                const members = membersOf(c.id);
                const summary = summaries.get(c.id);
                return (
                  <li key={c.id}>
                    <Card className="grid gap-2 p-4 text-[13px]" data-testid="feedback-issue">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="info">{categoryLabel(c.category)}</Badge>
                        {c.suggested_priority && <Badge tone={PRIORITY_TONE[c.suggested_priority]}>Suggested priority: {c.suggested_priority}</Badge>}
                        {c.status !== "open" && <Badge tone="neutral">{STATUS_LABEL[c.status]}</Badge>}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {c.confidence !== null && `Confidence ${Math.round(c.confidence * 100)}%`}
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
                              label={summary ? "Try summary again" : "Summarize with AI"} pendingLabel="Requesting…" variant="ghost" />
                          )}
                          {(["acknowledged", "resolved", "dismissed", "open"] as const).filter((s) => s !== c.status).map((s) => (
                            <ActionForm key={s} action={setClusterStatusAction} fields={{ workspaceId: workspace.id, clusterId: c.id, status: s }}
                              label={s === "open" ? "Reopen" : s === "acknowledged" ? "Acknowledge" : s === "resolved" ? "Mark resolved" : "Dismiss"} variant="ghost" />
                          ))}
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
