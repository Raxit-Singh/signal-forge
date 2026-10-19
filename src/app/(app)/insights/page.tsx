import type { Metadata } from "next";
import Link from "next/link";
import { Lightbulb, PackagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveProduct, requireWorkspace } from "@/lib/server/session";
import { workspaceAvailability } from "@/lib/server/ai/gateway";
import { categoryLabel } from "@/lib/ai/cluster";
import { STATUS_LABEL as TASK_STATUS } from "@/lib/agent/tasks";
import { formatTime } from "@/lib/format";
import { getTimeZone } from "@/lib/server/timezone";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { CLUSTER_COLS, PRIORITY_TONE, TREND_LABEL, nameOf, type Cluster } from "@/components/feedback/issue-parts";

export const metadata: Metadata = { title: "Product Insights" };

const KIND_LABEL: Record<string, string> = {
  cluster_summary: "Summary", feature_evaluation: "Feature evaluation", issue_draft: "GitHub draft",
  github_duplicates: "GitHub check", spike_explanation: "Spike explanation",
};
const RESULT: Record<string, { label: string; tone: "positive" | "neutral" | "negative" | "info" }> = {
  completed: { label: "Ready", tone: "positive" }, insufficient_data: { label: "Insufficient data", tone: "neutral" },
  failed: { label: "Failed", tone: "negative" }, pending: { label: "Working", tone: "info" }, running: { label: "Working", tone: "info" },
};

export default async function InsightsPage() {
  const tz = await getTimeZone();
  const at = (d: string | Date) => formatTime(d, tz);
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  if (!product) {
    return (
      <>
        <PageHeader title="Product Insights" />
        <EmptyState icon={PackagePlus} title="Add a product first" action={{ href: "/onboarding/product", label: "Add product" }}>
          Insights are built from a product&apos;s feedback.
        </EmptyState>
      </>
    );
  }
  const supabase = await createClient();
  const [ai, clustersRes, invRes, tasksRes] = await Promise.all([
    workspaceAvailability(createAdminClient(), workspace.id),
    supabase.from("feedback_clusters").select(CLUSTER_COLS).eq("product_id", product.id).in("status", ["open", "acknowledged"])
      .order("priority_score", { ascending: false, nullsFirst: false }).order("report_count", { ascending: false }).limit(50),
    supabase.from("ai_investigations").select("id, kind, subject_key, cluster_id, title, status, completed_at, created_at")
      .eq("product_id", product.id).order("created_at", { ascending: false }).limit(200),
    supabase.from("agent_tasks").select("id, stage, status, cluster_id, created_at, pr_url").eq("product_id", product.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const clusters = (clustersRes.data ?? []) as Cluster[];
  const invs = (invRes.data ?? []) as Array<{ id: string; kind: string; subject_key: string | null; cluster_id: string | null; title: string | null; status: string; completed_at: string | null; created_at: string }>;
  const done = new Map<string, Set<string>>();
  for (const i of invs) {
    const key = i.cluster_id ?? i.subject_key;
    if (!key || i.status !== "completed") continue;
    if (!done.has(key)) done.set(key, new Set());
    done.get(key)!.add(i.kind);
  }
  const tasks = (tasksRes.data ?? []) as Array<{ id: string; stage: string; status: keyof typeof TASK_STATUS; cluster_id: string | null; created_at: string; pr_url: string | null }>;
  const titleOf = new Map(clusters.map((c) => [c.id, c.title]));
  const recent = invs.slice(0, 12);

  return (
    <>
      <PageHeader title="Product Insights" description={<>Evidence-based analysis of {product.name}&apos;s issues: summaries, feature evaluations, existing GitHub issues and issue drafts, with the posts behind every statement.</>} />
      <div className="grid gap-4">
        {!ai.ok && (
          <Card><CardContent className="p-4 text-[13px] text-muted-foreground">{ai.message} Analyses need SignalForge Intelligence; GitHub checks and the developer agent work without it. <Link href="/settings/ai" className="underline underline-offset-2">Details</Link></CardContent></Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Issues</CardTitle>
            <CardDescription>Open and acknowledged issues by priority. Open one to analyse it.</CardDescription>
          </CardHeader>
          <CardContent>
            {clusters.length === 0 ? (
              <EmptyState icon={Lightbulb} title="No issues yet" action={{ href: "/feedback", label: "Feedback Intelligence" }}>
                Issues appear when at least two people report the same bug, request or complaint.
              </EmptyState>
            ) : (
              <ul className="grid divide-y" aria-label="Issues" data-testid="insight-issues">
                {clusters.map((c) => {
                  const kinds = done.get(c.id);
                  return (
                    <li key={c.id} className="grid gap-1 py-2.5 text-[13px] first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/insights/${c.id}`} className="font-medium underline-offset-2 hover:underline">{c.title}</Link>
                        <Badge tone="info">{categoryLabel(c.category)}</Badge>
                        {c.suggested_priority && <Badge tone={PRIORITY_TONE[c.suggested_priority]}>{c.suggested_priority}</Badge>}
                        {c.priority_evidence && <span className="text-xs text-muted-foreground">{TREND_LABEL[c.priority_evidence.observed.trend]}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{c.report_count} reporter{c.report_count === 1 ? "" : "s"} · {c.platforms.map(nameOf).join(", ")}</span>
                        {kinds && [...kinds].map((k) => <span key={k} className="text-positive">✓ {KIND_LABEL[k] ?? k}</span>)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Recent analyses</CardTitle></CardHeader>
            <CardContent>
              {recent.length === 0 ? <p className="text-[13px] text-muted-foreground">None yet.</p> : (
                <ul className="grid gap-1.5 text-[13px]" aria-label="Recent analyses">
                  {recent.map((i) => {
                    const href = i.kind === "spike_explanation" ? "/buzz" : `/insights/${i.cluster_id ?? i.subject_key}`;
                    const r = RESULT[i.status] ?? RESULT.pending!;
                    return (
                      <li key={i.id} className="flex flex-wrap items-center gap-2">
                        <Badge tone={r.tone}>{r.label}</Badge>
                        <Link href={href} className="min-w-0 truncate underline-offset-2 hover:underline">{KIND_LABEL[i.kind] ?? i.kind}: {i.title ?? "Untitled"}</Link>
                        <span className="text-xs text-muted-foreground">{at(i.completed_at ?? i.created_at)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Developer agent</CardTitle>
              <CardDescription>Investigations your Claude ran in your codebase. <Link href="/settings/agent" className="underline underline-offset-2">Settings</Link></CardDescription>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? <p className="text-[13px] text-muted-foreground">No agent tasks yet. Start one from an issue.</p> : (
                <ul className="grid gap-1.5 text-[13px]" aria-label="Agent tasks">
                  {tasks.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{TASK_STATUS[t.status] ?? t.status}</Badge>
                      {t.cluster_id
                        ? <Link href={`/insights/${t.cluster_id}`} className="min-w-0 truncate underline-offset-2 hover:underline">{t.stage === "investigation" ? "Investigation" : "Implementation"}: {titleOf.get(t.cluster_id) ?? "issue"}</Link>
                        : <span>{t.stage}</span>}
                      {t.pr_url && <a href={t.pr_url} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2">Pull request</a>}
                      <span className="text-xs text-muted-foreground">{at(t.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
