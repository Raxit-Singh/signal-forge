import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspaces, hasRole } from "@/lib/server/session";
import { handoffFor } from "@/lib/server/agent/tasks";
import { STATUS_LABEL, isTerminal, type InvestigationReport, type TaskStatus } from "@/lib/agent/tasks";
import { Badge } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ai/action-form";
import { CopyBlock } from "./copy-block";
import { approvePlanAction, cancelTaskAction, startImplementationAction } from "@/app/actions/agent";
import { InvestigateForm } from "./investigate-form";

type Task = {
  id: string; stage: "investigation" | "implementation"; status: TaskStatus; execution: "routine" | "manual"; report: InvestigationReport | null;
  plan_hash: string | null; session_url: string | null; pr_url: string | null; pr_state: string | null; result_summary: string | null;
  error: string | null; created_at: string; parent_task_id: string | null; warnings: string[];
};

const TONE: Partial<Record<TaskStatus, "positive" | "negative" | "warning" | "info" | "neutral">> = {
  investigating: "info", implementing: "info", testing: "info", awaiting_approval: "warning", approved: "positive",
  pr_created: "positive", failed: "negative", cancelled: "neutral", awaiting_connection: "warning", awaiting_repository: "warning",
};

function Report({ r }: { r: InvestigationReport }) {
  const list = (title: string, items: string[]) => items.length ? (
    <div><p className="font-medium">{title}</p><ul className="list-disc pl-4 text-muted-foreground">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
  ) : null;
  return (
    <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-xs" data-testid="agent-report">
      <div className="flex flex-wrap gap-2">
        <Badge tone={r.recommendation === "implement" ? "positive" : r.recommendation === "do_not_implement" ? "negative" : "warning"}>
          {r.recommendation === "implement" ? "Recommends implementing" : r.recommendation === "do_not_implement" ? "Recommends not implementing" : "Needs more information"}
        </Badge>
        <Badge tone="neutral">Feasibility: {r.feasibility}</Badge>
        <Badge tone="neutral">Complexity: {r.complexity}</Badge>
      </div>
      <p className="whitespace-pre-wrap">{r.summary}</p>
      {r.expected_benefit && <p><span className="font-medium">Expected benefit: </span><span className="text-muted-foreground">{r.expected_benefit}</span></p>}
      {r.affected_components.length > 0 && (
        <div><p className="font-medium">Likely affected</p><ul className="list-disc pl-4 text-muted-foreground">
          {r.affected_components.map((c, i) => <li key={i}><code className="font-mono">{c.path}</code> — {c.reason}</li>)}
        </ul></div>
      )}
      {list("Risks", r.risks)}
      <div><p className="font-medium">Implementation plan</p><ol className="list-decimal pl-4 text-muted-foreground">{r.implementation_plan.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
      {list("Tests", r.tests)}
      {list("Open questions", r.open_questions)}
      <p className="text-muted-foreground">Written by Claude after reading your repository. Text is shown as Claude wrote it; check it before approving.</p>
    </div>
  );
}

/**
 * Developer agent controls on a feedback issue: start an investigation (no code changes, by instruction),
 * review the report, approve that exact plan, start the implementation, follow
 * the pull request. Runs in the customer's Claude, not on SignalForge.
 */
export async function AgentIssueControls({ workspaceId, clusterId }: { workspaceId: string; clusterId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("agent_tasks")
    .select("id, stage, status, execution, report, plan_hash, session_url, pr_url, pr_state, result_summary, error, created_at, parent_task_id, warnings")
    .eq("cluster_id", clusterId).order("created_at", { ascending: false }).limit(4);
  const tasks = (data ?? []) as Task[];
  const role = (await getWorkspaces()).find((w) => w.id === workspaceId)?.role;
  const isAdmin = !!role && hasRole(role, "admin");
  const inv = tasks.find((t) => t.stage === "investigation");
  const impl = inv ? tasks.find((t) => t.stage === "implementation" && t.parent_task_id === inv.id) : undefined;
  const canStartNew = !inv || ["failed", "cancelled", "pr_created"].includes(inv.status);
  // Only whether a routine exists (members can't read the connection row itself).
  const { count: routines } = await createAdminClient().from("agent_connections").select("workspace_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId).neq("status", "revoked");

  return (
    <div className="grid gap-2 border-t pt-2" data-testid="agent-controls">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">Developer agent (Claude)</span>
        {inv && <Badge tone={TONE[inv.status] ?? "neutral"} data-testid="agent-status">{STATUS_LABEL[inv.status]}</Badge>}
        {impl && <Badge tone={TONE[impl.status] ?? "neutral"}>Implementation: {STATUS_LABEL[impl.status]}</Badge>}
      </div>
      {canStartNew && <InvestigateForm workspaceId={workspaceId} clusterId={clusterId} routine={(routines ?? 0) > 0} />}
      {inv && (inv.status === "awaiting_connection" || inv.status === "awaiting_repository") && (
        <p className="text-xs text-muted-foreground">
          {inv.status === "awaiting_connection" ? "Connect Claude to SignalForge first" : "Link this product's GitHub repository first"} in{" "}
          <Link href="/settings/agent" className="underline underline-offset-2">Settings → Developer agent</Link>, then start again.
        </p>
      )}
      {[inv, impl].filter((t): t is Task => !!t && !isTerminal(t.status) && t.execution === "manual" && ["not_started", "investigating", "implementing"].includes(t.status)).map((t) => (
        <div key={t.id} className="grid gap-1 text-xs">
          <p className="text-muted-foreground">
            No Claude Code routine is connected, so start this {t.stage} yourself: open Claude Code with the SignalForge connector and give it this request.
          </p>
          <CopyBlock label="Request for Claude Code" text={handoffFor(t.id)} />
        </div>
      ))}
      {[inv, impl].filter((t): t is Task => !!t?.session_url).map((t) => (
        <a key={t.id} href={t.session_url!} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs underline underline-offset-2">
          Open the Claude Code {t.stage} session <ExternalLink className="size-3" aria-hidden />
        </a>
      ))}
      {inv?.error && <p className="text-xs text-negative">{inv.error}</p>}
      {inv?.report && <Report r={inv.report} />}
      {inv && inv.warnings.length > 0 && (
        <ul className="grid gap-1 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs" data-testid="agent-warnings">
          {inv.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {inv?.status === "awaiting_approval" && inv.plan_hash && inv.report?.recommendation !== "do_not_implement" && (
        isAdmin
          ? <ActionForm action={approvePlanAction} fields={{ workspaceId, taskId: inv.id, planHash: inv.plan_hash }} label="Approve this plan" pendingLabel="Approving…" variant="default" />
          : <p className="text-xs text-muted-foreground">A workspace admin can approve this plan.</p>
      )}
      {inv?.status === "approved" && (
        isAdmin
          ? <ActionForm action={startImplementationAction} fields={{ workspaceId, taskId: inv.id }} label="Start implementation" pendingLabel="Starting…" variant="default" />
          : <p className="text-xs text-muted-foreground">Approved. A workspace admin can start the implementation.</p>
      )}
      {impl && (
        <div className="grid gap-1 text-xs">
          {impl.pr_url && (
            <a href={impl.pr_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium underline underline-offset-2" data-testid="agent-pr">
              Pull request for review <ExternalLink className="size-3" aria-hidden />
              {impl.pr_state && <Badge tone="neutral">{impl.pr_state === "unverified" ? "not verified with GitHub" : impl.pr_state}</Badge>}
            </a>
          )}
          {impl.result_summary && <p className="whitespace-pre-wrap text-muted-foreground">{impl.result_summary}</p>}
          {impl.error && <p className="text-negative">{impl.error}</p>}
        </div>
      )}
      {[impl, inv].filter((t): t is Task => !!t && !isTerminal(t.status)).slice(0, 1).map((t) => (
        <ActionForm key={t.id} action={cancelTaskAction} fields={{ workspaceId, taskId: t.id }} label={`Cancel ${t.stage}`} variant="ghost" />
      ))}
    </div>
  );
}
