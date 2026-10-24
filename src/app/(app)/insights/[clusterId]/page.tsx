import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasRole, requireWorkspace } from "@/lib/server/session";
import { workspaceAvailability } from "@/lib/server/ai/gateway";
import { categoryLabel } from "@/lib/ai/cluster";
import { demandStrength } from "@/lib/insights/insights";
import type { DuplicateReport } from "@/lib/server/insights/github-duplicates";
import { uuidSchema } from "@/lib/validation/schemas";
import { formatTime } from "@/lib/format";
import { getTimeZone } from "@/lib/server/timezone";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ai/action-form";
import { InvestigationResult, type InvestigationView } from "@/components/ai/investigation-result";
import { AgentIssueControls } from "@/components/agent/issue-controls";
import {
  AGENT_CATEGORIES, CLUSTER_COLS, Evidence, PRIORITY_TONE, PriorityEvidence, STATUS_LABEL, TREND_LABEL, nameOf, type Cluster, type Member,
} from "@/components/feedback/issue-parts";
import { analyzeIssueAction, checkDuplicatesAction } from "@/app/actions/insights";
import { setClusterStatusAction } from "@/app/actions/feedback";
import { DraftEditor } from "../insights-client";

export const metadata: Metadata = { title: "Issue insight" };

const DEMAND_TONE = { strong: "positive", moderate: "info", early: "neutral" } as const;

export default async function IssueInsightPage({ params }: { params: Promise<{ clusterId: string }> }) {
  const tz = await getTimeZone();
  const at = (d: string | Date) => formatTime(d, tz);
  const { clusterId } = await params;
  if (!uuidSchema.safeParse(clusterId).success) notFound();
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data } = await supabase.from("feedback_clusters").select(`${CLUSTER_COLS}, product_id`).eq("id", clusterId).eq("workspace_id", workspace.id).maybeSingle();
  if (!data) notFound();
  const c = data as unknown as Cluster & { product_id: string };

  const [{ data: product }, { data: members }, { data: invs }, ai, testRes] = await Promise.all([
    supabase.from("products").select("name, github_repo").eq("id", c.product_id).single(),
    supabase.from("feedback_cluster_members").select("mention_id").eq("cluster_id", c.id).limit(200),
    supabase.from("ai_investigations").select("kind, status, report, error, model, completed_at").eq("product_id", c.product_id).eq("subject_key", c.id)
      .in("kind", ["cluster_summary", "feature_evaluation", "issue_draft", "github_duplicates"]),
    workspaceAvailability(createAdminClient(), workspace.id),
    supabase.from("mentions").select("id", { count: "exact", head: true }).eq("product_id", c.product_id).eq("processing_status", "classified").like("ai_model", "test:%"),
  ]);
  const ids = (members ?? []).map((m) => m.mention_id as string);
  const { data: rows } = ids.length
    ? await supabase.from("mentions").select("id, title, content, source, source_url, published_at, author_display").in("id", ids).order("published_at", { ascending: false })
    : { data: [] };
  const posts = (rows ?? []) as Member[];
  const by = new Map((invs ?? []).map((i) => [i.kind as string, i as unknown as InvestigationView]));
  const summary = by.get("cluster_summary");
  const evaluation = by.get("feature_evaluation");
  const draft = by.get("issue_draft");
  const dup = by.get("github_duplicates") as (InvestigationView & { report: DuplicateReport | null }) | undefined;
  const canAct = hasRole(workspace.role, "member");
  const isFeature = c.category === "feature_request";
  const draftable = AGENT_CATEGORIES.includes(c.category);
  const ev = c.priority_evidence;
  const demand = isFeature && ev ? demandStrength(ev.observed) : null;
  const repo = (product?.github_repo as string | null) ?? null;
  const aiOff = !ai.ok ? <p className="text-xs text-muted-foreground">{ai.message} <Link href="/settings/ai" className="underline underline-offset-2">Details</Link></p> : null;
  const fields = (kind: string, again: boolean) => ({ workspaceId: workspace.id, clusterId: c.id, kind, force: again ? "true" : "false" });
  const testLabels = (testRes.count ?? 0) > 0;

  return (
    <div className="grid gap-4">
      <Link href="/insights" className="inline-flex w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden />Product Insights</Link>
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">{categoryLabel(c.category)}</Badge>
          {c.suggested_priority && <Badge tone={PRIORITY_TONE[c.suggested_priority]}>Priority: {c.suggested_priority}</Badge>}
          {ev && <Badge tone="neutral">{TREND_LABEL[ev.observed.trend]}</Badge>}
          <Badge tone="neutral">{STATUS_LABEL[c.status]}</Badge>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{c.title}</h1>
        <p className="text-[13px] text-muted-foreground">
          {product?.name as string} · <span className="font-medium text-foreground tabular">{c.report_count}</span> independent report{c.report_count === 1 ? "" : "s"}
          {` · ${c.platforms.map(nameOf).join(", ")}`}
          {c.first_detected_at && ` · first ${c.first_detected_at.slice(0, 10)}`}{c.last_detected_at && `, latest ${c.last_detected_at.slice(0, 10)}`}
        </p>
        {ev && <PriorityEvidence ev={ev} testLabels={testLabels} open />}
        {canAct && (
          <div className="flex flex-wrap gap-1">
            {(["acknowledged", "resolved", "dismissed", "open"] as const).filter((s) => s !== c.status).map((s) => (
              <ActionForm key={s} action={setClusterStatusAction} fields={{ workspaceId: workspace.id, clusterId: c.id, status: s }}
                label={s === "open" ? "Reopen" : s === "acknowledged" ? "Acknowledge" : s === "resolved" ? "Mark resolved" : "Dismiss"} variant="ghost" />
            ))}
          </div>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Posts ({posts.length})</CardTitle>
            <CardDescription>Everything below is built from these posts.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 border-l pl-3" aria-label="Supporting posts">{posts.map((m) => <Evidence key={m.id} m={m} tz={tz} />)}</ul>
          </CardContent>
        </Card>

        <div className="grid h-fit gap-4">
          <Card>
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardContent className="grid gap-2">
              {summary ? <InvestigationResult inv={summary} /> : <p className="text-[13px] text-muted-foreground">Not summarised yet.</p>}
              {canAct && ai.ok && (!summary || ["failed", "insufficient_data"].includes(summary.status)) && (
                <ActionForm action={analyzeIssueAction} fields={fields("cluster_summary", Boolean(summary))} label={summary ? "Try again" : "Summarize"} pendingLabel="Requesting…" />
              )}
              {!summary && aiOff}
            </CardContent>
          </Card>

          {isFeature && (
            <Card data-testid="feature-evaluation">
              <CardHeader>
                <CardTitle>Feature evaluation</CardTitle>
                <CardDescription>What people need, how they&apos;d use it, what they do today and their concerns — each from their own posts.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {demand && (
                  <div className="grid gap-1 rounded-md border p-3 text-[13px]" data-testid="demand">
                    <div className="flex items-center gap-2"><span className="font-medium">Demand</span><Badge tone={DEMAND_TONE[demand.level]}>{demand.level}</Badge>
                      <span className="text-xs text-muted-foreground">measured, not AI</span></div>
                    <ul className="list-disc pl-4 text-xs text-muted-foreground">{demand.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  </div>
                )}
                {evaluation ? <InvestigationResult inv={evaluation} /> : <p className="text-[13px] text-muted-foreground">Not evaluated yet.</p>}
                {canAct && ai.ok && (!evaluation || ["failed", "insufficient_data", "completed"].includes(evaluation.status)) && (
                  <ActionForm action={analyzeIssueAction} fields={fields("feature_evaluation", Boolean(evaluation))} label={evaluation ? "Evaluate again" : "Evaluate request"} pendingLabel="Requesting…" />
                )}
                {!evaluation && aiOff}
              </CardContent>
            </Card>
          )}

          <Card data-testid="github-duplicates">
            <CardHeader>
              <CardTitle>Already on GitHub?</CardTitle>
              <CardDescription>
                {repo ? <>Searches issues in <a href={`https://github.com/${repo}/issues`} target="_blank" rel="noreferrer" className="underline underline-offset-2">{repo}</a> (public repositories) for the same words. Read-only.</>
                  : <>Add the product&apos;s GitHub repository in <Link href="/settings/products" className="underline underline-offset-2">product settings</Link> to search its issues.</>}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 text-[13px]">
              {dup?.status === "failed" && <p className="text-xs text-negative">{dup.error}</p>}
              {dup?.status === "completed" && dup.report && (
                dup.report.matches.length === 0
                  ? <p className="text-muted-foreground">No existing issues share this issue&apos;s words ({dup.report.words.join(", ")}).</p>
                  : (
                    <ul className="grid gap-1.5" aria-label="Existing GitHub issues">
                      {dup.report.matches.map((m) => (
                        <li key={m.number} className="flex flex-wrap items-center gap-2">
                          {m.likely ? <Badge tone="warning">Likely the same</Badge> : <Badge tone="neutral">Possibly related</Badge>}
                          <a href={m.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                            #{m.number} {m.title}<ExternalLink className="size-3" aria-hidden />
                          </a>
                          <span className="text-xs text-muted-foreground">{m.state} · shares {m.shared.join(", ")}</span>
                        </li>
                      ))}
                    </ul>
                  )
              )}
              {dup?.completed_at && <p className="text-xs text-muted-foreground">Checked {at(dup.completed_at)}{dup.report ? ` · searched for ${dup.report.words.join(", ")}` : ""}.</p>}
              {canAct && repo && <ActionForm action={checkDuplicatesAction} fields={{ workspaceId: workspace.id, clusterId: c.id }} label={dup ? "Check again" : "Check GitHub"} pendingLabel="Searching…" />}
            </CardContent>
          </Card>

          {draftable && (
            <Card>
              <CardHeader>
                <CardTitle>GitHub issue draft</CardTitle>
                <CardDescription>A draft written only from these posts, with numbered sources. You edit it and file it on GitHub yourself.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {draft?.status === "completed" && draft.report?.draft
                  ? <DraftEditor title={draft.report.draft.title} body={draft.report.draft.body} repo={repo} />
                  : draft ? <InvestigationResult inv={draft} /> : <p className="text-[13px] text-muted-foreground">No draft yet.</p>}
                {canAct && ai.ok && (!draft || ["failed", "insufficient_data", "completed"].includes(draft.status)) && (
                  <ActionForm action={analyzeIssueAction} fields={fields("issue_draft", Boolean(draft))} label={draft ? "Draft again" : "Draft GitHub issue"} pendingLabel="Requesting…" />
                )}
                {!draft && aiOff}
              </CardContent>
            </Card>
          )}

          {canAct && draftable && (
            <Card>
              <CardHeader>
                <CardTitle>Fix it with Claude</CardTitle>
                <CardDescription>Opens Claude ready to find the cause in your code and suggest a fix. Needs SignalForge connected to Claude (one time).</CardDescription>
              </CardHeader>
              <CardContent><AgentIssueControls workspaceId={workspace.id} clusterId={c.id} /></CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
