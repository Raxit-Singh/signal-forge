import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  approvalCovers, buildContextPackage, canTransition, firePayload, implementationUpdateSchema, investigationReportSchema, isTerminal,
  CHANNEL_CLIENT_NAME, channelListening, LOCAL_REPOSITORY, manualHandoff, planHash, prMatchesRepository, parsePrUrl, stableHash, stageInstructions,
  type ImplementationUpdate, type QueuedTask, type InvestigationReport, type TaskStage, type TaskStatus,
} from "@/lib/agent/tasks";
import { fireRoutine } from "@/lib/agent/routine";
import { getPullRequest, installationToken, pullRequestsSince } from "@/lib/agent/github-app";
import { mockAllowed } from "@/lib/ai/mock";
import { resourceUrl } from "@/lib/agent/oauth";
import { serverEnv } from "@/lib/server/env";
import { publicEnv } from "@/lib/env";
import { decryptKey } from "@/lib/server/ai/secrets";
import { audit, type McpPrincipal } from "./oauth-store";

// Developer agent workflow (SYSTEM B). SignalForge never runs a model here and
// never pays for the customer's coding agent: work runs in the customer's Claude
// (their routine, or Claude Code they run themselves) and reports back through
// the SignalForge MCP tools. This module enforces stages, approvals and scope.

/** Tasks without a report after this long are marked failed (the routine has no status API). */
export const TASK_TIMEOUT_HOURS = 6;

export type ReadinessState =
  | "not_connected" | "setup_required" | "mcp_connected" | "repository_required"
  | "execution_unavailable" | "ready" | "error";

export interface Readiness {
  state: ReadinessState;
  mcp: { authorized: boolean; used: boolean; lastUsedAt: string | null };
  routine: { saved: boolean; status: string | null; routineId: string | null; lastError: string | null; lastFiredAt: string | null };
  repository: { fullName: string; defaultBranch: string; private: boolean } | null;
  githubApp: { configured: boolean; installations: number };
}

export function githubAppConfig() {
  const e = serverEnv();
  if (!e.GITHUB_APP_ID || !e.GITHUB_APP_SLUG || !e.GITHUB_APP_CLIENT_ID || !e.GITHUB_APP_CLIENT_SECRET || !e.GITHUB_APP_PRIVATE_KEY) return null;
  return {
    appId: e.GITHUB_APP_ID, slug: e.GITHUB_APP_SLUG, clientId: e.GITHUB_APP_CLIENT_ID, clientSecret: e.GITHUB_APP_CLIENT_SECRET,
    privateKeyPem: e.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
  };
}

export async function readiness(admin: SupabaseClient, workspaceId: string, productId: string | null): Promise<Readiness> {
  const [{ data: grants }, { data: conn }, { data: repo }, { data: inst }] = await Promise.all([
    admin.from("oauth_grants").select("last_used_at").eq("workspace_id", workspaceId).is("revoked_at", null).order("last_used_at", { ascending: false, nullsFirst: false }).limit(1),
    admin.from("agent_connections").select("routine_id, status, last_error, last_fired_at").eq("workspace_id", workspaceId).maybeSingle(),
    productId ? admin.from("agent_repositories").select("full_name, default_branch, private").eq("product_id", productId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("github_installations").select("id", { count: "exact" }).eq("workspace_id", workspaceId).is("revoked_at", null),
  ]);
  const g = grants?.[0] as { last_used_at: string | null } | undefined;
  const mcp = { authorized: !!g, used: !!g?.last_used_at, lastUsedAt: g?.last_used_at ?? null };
  const routine = {
    saved: !!conn && conn.status !== "revoked", status: (conn?.status as string | undefined) ?? null, routineId: (conn?.routine_id as string | undefined) ?? null,
    lastError: (conn?.last_error as string | null | undefined) ?? null, lastFiredAt: (conn?.last_fired_at as string | null | undefined) ?? null,
  };
  const repository = repo ? { fullName: repo.full_name as string, defaultBranch: repo.default_branch as string, private: repo.private as boolean } : null;
  const state: ReadinessState =
    routine.status === "error" ? "error"
    : !mcp.authorized && !routine.saved ? "not_connected"
    : !mcp.used ? "setup_required"
    : !repository ? "repository_required"
    : !routine.saved ? "execution_unavailable"
    : "ready";
  return { state, mcp, routine, repository, githubApp: { configured: !!githubAppConfig(), installations: (inst ?? []).length } };
}

async function event(admin: SupabaseClient, workspaceId: string, taskId: string, kind: string, actor: "user" | "signalforge" | "agent", detail: Record<string, unknown> = {}) {
  await admin.from("agent_task_events").insert({ workspace_id: workspaceId, task_id: taskId, kind, actor, detail });
}

async function setStatus(admin: SupabaseClient, task: { id: string; workspace_id: string; status: TaskStatus }, to: TaskStatus, patch: Record<string, unknown>, actor: "user" | "signalforge" | "agent") {
  if (!canTransition(task.status, to) && task.status !== to) throw new AgentError(`Can't move from ${task.status} to ${to}.`);
  const { data } = await admin.from("agent_tasks").update({ status: to, ...patch }).eq("id", task.id).eq("status", task.status).select("id");
  if (!data?.length) throw new AgentError("The task changed meanwhile; try again.");
  await event(admin, task.workspace_id, task.id, `status:${to}`, actor, { from: task.status });
}

export class AgentError extends Error {}

const mcpUrl = () => resourceUrl(publicEnv.NEXT_PUBLIC_SITE_URL);

/** Fires the customer's routine for a task. Returns the session or an error message (nothing is retried automatically). */
async function fire(admin: SupabaseClient, workspaceId: string, taskId: string): Promise<{ ok: true; sessionId: string; sessionUrl: string } | { ok: false; message: string }> {
  const { data: conn } = await admin.from("agent_connections").select("fire_url, secret_id, status").eq("workspace_id", workspaceId).maybeSingle();
  if (!conn?.secret_id || conn.status === "revoked") return { ok: false, message: "No Claude Code routine is connected." };
  const token = await decryptKey(admin, workspaceId, conn.secret_id as string);
  if (!token) return { ok: false, message: "The routine token couldn't be read. Save it again." };
  const r = await fireRoutine(conn.fire_url as string, token, firePayload(taskId));
  if (r.ok) {
    await admin.from("agent_connections").update({ status: "ready", last_fired_at: new Date().toISOString(), last_error: null }).eq("workspace_id", workspaceId);
    return r;
  }
  await admin.from("agent_connections").update({ status: r.kind === "auth" || r.kind === "not_found" ? "error" : conn.status, last_error: r.message }).eq("workspace_id", workspaceId);
  return { ok: false, message: r.message };
}

type TaskRow = {
  id: string; workspace_id: string; product_id: string; cluster_id: string | null; repository_id: string | null; execution: "routine" | "manual";
  stage: TaskStage; status: TaskStatus; context: Record<string, unknown>; report: InvestigationReport | null; plan_hash: string | null;
  parent_task_id: string | null; pr_url: string | null; session_url: string | null;
};
const TASK_COLS = "id, workspace_id, product_id, cluster_id, repository_id, execution, stage, status, context, report, plan_hash, parent_task_id, pr_url, session_url";

/** The repository a task is bound to: the linked one, or the user's Claude Code folder for manual tasks. */
async function taskRepository(admin: SupabaseClient, task: Pick<TaskRow, "repository_id" | "execution">) {
  if (task.repository_id) {
    const { data } = await admin.from("agent_repositories").select("full_name, default_branch, installation_id").eq("id", task.repository_id).maybeSingle();
    if (data) return { fullName: data.full_name as string, defaultBranch: data.default_branch as string, installationId: data.installation_id as number, local: false };
  }
  return task.execution === "manual" ? { fullName: LOCAL_REPOSITORY, defaultBranch: null, installationId: null, local: true } : null;
}

async function loadTask(admin: SupabaseClient, taskId: string, workspaceId: string): Promise<TaskRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return null;
  const { data } = await admin.from("agent_tasks").select(TASK_COLS).eq("id", taskId).eq("workspace_id", workspaceId).maybeSingle();
  return data as TaskRow | null;
}

/** Builds the context package for an issue (this issue only; bounded). */
export async function issueContext(admin: SupabaseClient, workspaceId: string, clusterId: string) {
  const { data: c } = await admin.from("feedback_clusters")
    .select("id, product_id, category, title, suggested_priority, report_count, platforms, first_detected_at, last_detected_at, area, priority_evidence")
    .eq("id", clusterId).eq("workspace_id", workspaceId).maybeSingle();
  if (!c) return null;
  const [{ data: p }, { data: members }, { data: repo }, { data: summary }] = await Promise.all([
    admin.from("products").select("name, website_url, description, category").eq("id", c.product_id).maybeSingle(),
    admin.from("feedback_cluster_members").select("mention_id").eq("cluster_id", clusterId).limit(50),
    admin.from("agent_repositories").select("id, full_name, default_branch").eq("product_id", c.product_id).maybeSingle(),
    admin.from("ai_investigations").select("report, status").eq("product_id", c.product_id).eq("kind", "cluster_summary").eq("subject_key", clusterId).maybeSingle(),
  ]);
  const ids = (members ?? []).map((m) => m.mention_id as string);
  const { data: mentions } = ids.length
    ? await admin.from("mentions").select("source_url, source, published_at, title, content").in("id", ids).order("published_at", { ascending: false }).limit(20)
    : { data: [] };
  const context = buildContextPackage({
    product: { name: p?.name as string, website: (p?.website_url as string | null) ?? null, description: (p?.description as string | null) ?? null, category: (p?.category as string | null) ?? null },
    issue: {
      id: c.id as string, category: c.category as string, title: c.title as string, priority: (c.suggested_priority as string | null) ?? null,
      reporters: c.report_count as number, platforms: (c.platforms as string[]) ?? [],
      trend: ((c.priority_evidence as { observed?: { trend?: string } } | null)?.observed?.trend) ?? null,
      firstSeen: c.first_detected_at as string | null, lastSeen: c.last_detected_at as string | null, area: (c.area as string | null) ?? null,
      summary: summary?.status === "completed" ? ((summary.report as { summary?: string } | null)?.summary ?? null) : null,
    },
    evidence: (mentions ?? []).map((m) => ({ url: m.source_url as string, source: m.source as string, published: m.published_at as string, title: m.title as string | null, text: m.content as string | null })),
    repository: repo ? { fullName: repo.full_name as string, defaultBranch: repo.default_branch as string } : null,
  });
  return { context, productId: c.product_id as string, repositoryId: (repo?.id as string | undefined) ?? null };
}

/**
 * "Investigate with Claude": creates an investigation task for an issue and starts
 * it in the customer's routine when one is connected. The routine can't be made
 * technically read-only, so starting it needs `acknowledged` (the user confirmed
 * that). Never asks for code changes. One active investigation per issue.
 */
export async function startInvestigation(admin: SupabaseClient, o: { workspaceId: string; clusterId: string; userId: string; acknowledged: boolean }) {
  const { data: active } = await admin.from("agent_tasks").select("id, status").eq("cluster_id", o.clusterId).eq("workspace_id", o.workspaceId)
    .eq("stage", "investigation").not("status", "in", "(failed,cancelled,pr_created)").order("created_at", { ascending: false }).limit(1);
  if (active?.length) return { taskId: active[0]!.id as string, status: active[0]!.status as TaskStatus, existing: true };

  const ic = await issueContext(admin, o.workspaceId, o.clusterId);
  if (!ic) throw new AgentError("Issue not found.");
  const ready = await readiness(admin, o.workspaceId, ic.productId);
  const execution = ready.routine.saved ? "routine" : "manual";
  if (execution === "routine" && !o.acknowledged) {
    throw new AgentError("Confirm that you understand the routine runs with your Claude Code permissions before starting it.");
  }
  // A routine runs in the cloud and needs a linked repository; a manual task runs in the user's
  // own Claude Code session, whose folder is the repository when none is linked.
  const status: TaskStatus = !ready.mcp.authorized ? "awaiting_connection" : !ic.repositoryId && execution === "routine" ? "awaiting_repository" : "not_started";
  const { data: task, error } = await admin.from("agent_tasks").insert({
    workspace_id: o.workspaceId, product_id: ic.productId, cluster_id: o.clusterId, repository_id: ic.repositoryId, execution,
    stage: "investigation", status, context: ic.context, context_hash: stableHash(ic.context), created_by: o.userId,
    execution_acknowledged_at: execution === "routine" ? new Date().toISOString() : null,
  }).select("id").single();
  if (error || !task) throw new AgentError("Couldn't create the task.");
  const taskId = task.id as string;
  await event(admin, o.workspaceId, taskId, "created", "user", { execution });
  await audit(admin, o.workspaceId, o.userId, "agent.investigation_requested", taskId, { cluster_id: o.clusterId });

  if (status === "not_started" && execution === "routine") {
    const r = await fire(admin, o.workspaceId, taskId);
    const row = { id: taskId, workspace_id: o.workspaceId, status };
    if (r.ok) await setStatus(admin, row, "investigating", { session_id: r.sessionId, session_url: r.sessionUrl, started_at: new Date().toISOString() }, "signalforge");
    else await setStatus(admin, row, "failed", { error: r.message.slice(0, 500), completed_at: new Date().toISOString() }, "signalforge");
    return { taskId, status: r.ok ? "investigating" as const : "failed" as const, existing: false };
  }
  return { taskId, status, existing: false };
}

/** The manual handoff text for a task (when no routine is connected, or to rerun by hand). */
export const handoffFor = (taskId: string) => manualHandoff(taskId, mcpUrl());

/** User approves the exact plan they saw (its hash). Scoped to issue, repository, plan and environment. */
export async function approvePlan(admin: SupabaseClient, o: { workspaceId: string; taskId: string; planHash: string; userId: string }) {
  const task = await loadTask(admin, o.taskId, o.workspaceId);
  if (!task || task.stage !== "investigation") throw new AgentError("Investigation not found.");
  if (task.status !== "awaiting_approval" || !task.report || !task.plan_hash) throw new AgentError("There is no plan waiting for approval.");
  if (task.plan_hash !== o.planHash) throw new AgentError("The plan changed since you opened it. Review it again.");
  if (task.report.recommendation === "do_not_implement") throw new AgentError("Claude recommended not implementing this; there is nothing to approve.");
  const repo = await taskRepository(admin, task);
  if (!repo) throw new AgentError("No repository is authorized for this product.");
  const environment = await environmentId(admin, o.workspaceId);
  const { error } = await admin.from("agent_approvals").insert({
    workspace_id: o.workspaceId, investigation_task_id: task.id, cluster_id: task.cluster_id, repository_full_name: repo.fullName,
    plan_hash: task.plan_hash, environment, approved_by: o.userId,
  });
  if (error) throw new AgentError("This plan already has an approval.");
  await setStatus(admin, task, "approved", {}, "user");
  await audit(admin, o.workspaceId, o.userId, "agent.plan_approved", task.id, { plan_hash: task.plan_hash, repository: repo.fullName, environment });
}

async function environmentId(admin: SupabaseClient, workspaceId: string) {
  const { data: conn } = await admin.from("agent_connections").select("routine_id, status").eq("workspace_id", workspaceId).maybeSingle();
  return conn && conn.status !== "revoked" ? `claude_code_routine:${conn.routine_id}` : "claude_code_manual";
}

/** Starts implementation of an approved plan (uses the approval once). */
export async function startImplementation(admin: SupabaseClient, o: { workspaceId: string; investigationTaskId: string; userId: string }) {
  const inv = await loadTask(admin, o.investigationTaskId, o.workspaceId);
  if (!inv || inv.stage !== "investigation" || inv.status !== "approved") throw new AgentError("This investigation has no approved plan.");
  const { data: a } = await admin.from("agent_approvals").select("id, workspace_id, investigation_task_id, cluster_id, repository_full_name, plan_hash, environment, used_at, revoked_at")
    .eq("investigation_task_id", inv.id).is("revoked_at", null).maybeSingle();
  if (!a) throw new AgentError("No approval found.");
  const repo = await taskRepository(admin, inv);
  const environment = await environmentId(admin, o.workspaceId);
  const check = approvalCovers({
    workspaceId: a.workspace_id as string, investigationTaskId: a.investigation_task_id as string, clusterId: (a.cluster_id as string | null) ?? null,
    repositoryFullName: a.repository_full_name as string, planHash: a.plan_hash as string, environment: a.environment as string,
    usedAt: (a.used_at as string | null) ?? null, revokedAt: (a.revoked_at as string | null) ?? null,
  }, { workspaceId: o.workspaceId, investigationTaskId: inv.id, clusterId: inv.cluster_id, repositoryFullName: repo?.fullName ?? "", planHash: inv.plan_hash ?? "", environment });
  if (!check.ok) throw new AgentError(`The approval doesn't cover this: ${check.reason}`);
  const { data: claimed } = await admin.from("agent_approvals").update({ used_at: new Date().toISOString() }).eq("id", a.id).is("used_at", null).select("id");
  if (!claimed?.length) throw new AgentError("This approval was already used.");

  const execution = environment.startsWith("claude_code_routine:") ? "routine" : "manual";
  const { data: task, error } = await admin.from("agent_tasks").insert({
    workspace_id: o.workspaceId, product_id: inv.product_id, cluster_id: inv.cluster_id, repository_id: inv.repository_id, execution,
    stage: "implementation", status: "not_started", parent_task_id: inv.id,
    context: { ...inv.context, approval_id: a.id, approved_plan: inv.report }, context_hash: stableHash({ ...inv.context, approval_id: a.id }),
    created_by: o.userId,
  }).select("id").single();
  if (error || !task) throw new AgentError("Couldn't create the implementation task.");
  const taskId = task.id as string;
  await setStatus(admin, inv, "implementing", {}, "user").catch(() => undefined);
  await event(admin, o.workspaceId, taskId, "created", "user", { approval_id: a.id, execution });
  await audit(admin, o.workspaceId, o.userId, "agent.implementation_started", taskId, { approval_id: a.id });
  if (execution === "routine") {
    const r = await fire(admin, o.workspaceId, taskId);
    const row = { id: taskId, workspace_id: o.workspaceId, status: "not_started" as TaskStatus };
    if (r.ok) await setStatus(admin, row, "implementing", { session_id: r.sessionId, session_url: r.sessionUrl, started_at: new Date().toISOString() }, "signalforge");
    else await setStatus(admin, row, "failed", { error: r.message.slice(0, 500), completed_at: new Date().toISOString() }, "signalforge");
  }
  return { taskId };
}

export async function cancelTask(admin: SupabaseClient, o: { workspaceId: string; taskId: string; userId: string }) {
  const task = await loadTask(admin, o.taskId, o.workspaceId);
  if (!task) throw new AgentError("Task not found.");
  if (isTerminal(task.status)) throw new AgentError("This task has already finished.");
  await setStatus(admin, task, "cancelled", { completed_at: new Date().toISOString() }, "user");
  if (task.stage === "investigation") {
    // An unused approval for a cancelled plan can never be used.
    await admin.from("agent_approvals").update({ revoked_at: new Date().toISOString() }).eq("investigation_task_id", task.id).is("used_at", null);
  }
  await audit(admin, o.workspaceId, o.userId, "agent.task_cancelled", task.id, {});
}

// ---------------------------------------------------------------------------
// Called by the agent through MCP tools (principal = the OAuth grant)
// ---------------------------------------------------------------------------

export async function agentGetTask(admin: SupabaseClient, who: McpPrincipal, taskId: string) {
  const task = await loadTask(admin, taskId, who.workspaceId);
  if (!task) throw new AgentError("No such task in this workspace.");
  if (isTerminal(task.status)) throw new AgentError(`This task is ${task.status}; do nothing further.`);
  const repo = await taskRepository(admin, task);
  if (!repo) throw new AgentError("No repository is authorized for this task yet. Ask the user to connect one in SignalForge.");
  const product = (task.context as { product?: { name?: string } }).product?.name;
  const repository = repo.local ? "the repository open in this Claude Code session" : repo.fullName;
  if (task.stage === "investigation") {
    if (!["not_started", "awaiting_connection", "awaiting_repository", "investigating"].includes(task.status)) throw new AgentError("The investigation stage is over.");
    if (task.status !== "investigating") {
      await admin.from("agent_tasks").update({ status: "investigating", started_at: new Date().toISOString() }).eq("id", task.id).eq("status", task.status);
      await event(admin, task.workspace_id, task.id, "status:investigating", "agent", { from: task.status });
    }
    return {
      task_id: task.id, stage: "investigation", code_changes_allowed: false, repository, default_branch: repo.defaultBranch,
      instructions: stageInstructions("investigation", repo.fullName, product), context: task.context,
      report_with: "submit_investigation_report",
    };
  }
  // Implementation: only with a valid, used-for-this-task approval of the exact plan.
  const parent = task.parent_task_id ? await loadTask(admin, task.parent_task_id, who.workspaceId) : null;
  const approvalId = (task.context as { approval_id?: string }).approval_id;
  const { data: a } = approvalId ? await admin.from("agent_approvals").select("plan_hash, repository_full_name, revoked_at, used_at").eq("id", approvalId).eq("workspace_id", who.workspaceId).maybeSingle() : { data: null };
  if (!parent || !a || a.revoked_at || !a.used_at || a.plan_hash !== parent.plan_hash || (a.repository_full_name as string).toLowerCase() !== repo.fullName.toLowerCase()) {
    throw new AgentError("This implementation has no valid approval. Do not change any code.");
  }
  if (!["not_started", "implementing", "testing"].includes(task.status)) throw new AgentError("The implementation stage is over.");
  if (task.status === "not_started") {
    await admin.from("agent_tasks").update({ status: "implementing", started_at: new Date().toISOString() }).eq("id", task.id).eq("status", "not_started");
    await event(admin, task.workspace_id, task.id, "status:implementing", "agent", { from: "not_started" });
  }
  return {
    task_id: task.id, stage: "implementation", repository, default_branch: repo.defaultBranch,
    instructions: stageInstructions("implementation", repo.fullName, product),
    approved_plan: parent.report, context: { ...task.context, approved_plan: undefined, approval_id: undefined },
    report_with: "report_implementation_status",
  };
}

export async function agentSubmitReport(admin: SupabaseClient, who: McpPrincipal, taskId: string, report: unknown) {
  const task = await loadTask(admin, taskId, who.workspaceId);
  if (!task || task.stage !== "investigation") throw new AgentError("No such investigation in this workspace.");
  if (!["investigating", "not_started"].includes(task.status)) throw new AgentError(`This investigation is ${task.status}; the report was not accepted.`);
  const parsed = investigationReportSchema.safeParse(report);
  if (!parsed.success) throw new AgentError(`The report doesn't match the required format: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const hash = planHash(parsed.data);
  const warnings = await changesDuringInvestigation(admin, task);
  await admin.from("agent_tasks").update({
    status: "awaiting_approval", report: parsed.data, plan_hash: hash, result_summary: parsed.data.summary.slice(0, 4000),
    completed_at: new Date().toISOString(), warnings,
  }).eq("id", task.id).in("status", ["investigating", "not_started"]);
  await event(admin, task.workspace_id, task.id, "report_submitted", "agent", { plan_hash: hash, recommendation: parsed.data.recommendation, warnings });
  return { accepted: true, plan_hash: hash, next: "The user will review the plan in SignalForge. Do not implement anything until a new implementation task is created." };
}

export async function agentReportImplementation(admin: SupabaseClient, who: McpPrincipal, taskId: string, update: unknown) {
  const task = await loadTask(admin, taskId, who.workspaceId);
  if (!task || task.stage !== "implementation") throw new AgentError("No such implementation task in this workspace.");
  if (isTerminal(task.status)) throw new AgentError(`This task is ${task.status}.`);
  const parsed = implementationUpdateSchema.safeParse(update);
  if (!parsed.success) throw new AgentError(`The update doesn't match the required format: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const u: ImplementationUpdate = parsed.data;
  const repo = await taskRepository(admin, task);
  const patch: Record<string, unknown> = { result_summary: u.summary ?? null, branch: u.branch ?? null };
  if (u.status === "pr_created") {
    // A local-folder task has no linked repository to match or check: the URL is recorded as reported.
    if (!u.pull_request_url || !repo || (!repo.local && !prMatchesRepository(u.pull_request_url, repo.fullName))) {
      throw new AgentError("A pull request URL in the approved repository is required.");
    }
    patch.pr_url = u.pull_request_url;
    patch.pr_number = parsePrUrl(u.pull_request_url)!.number;
    patch.pr_state = repo.local ? "unverified" : await verifyPr(repo.installationId!, repo.fullName, patch.pr_number as number, u.branch ?? null);
    patch.completed_at = new Date().toISOString();
  }
  if (u.status === "failed") {
    patch.error = (u.error ?? "The agent reported a failure.").slice(0, 500);
    patch.completed_at = new Date().toISOString();
  }
  if (u.tests) patch.result_summary = `${u.summary ?? ""}\nTests: ${u.tests.ran ? (u.tests.passed === null ? "ran" : u.tests.passed ? "passed" : "failed") : "not run"} — ${u.tests.summary}`.trim().slice(0, 4000);
  if (task.status !== u.status && !canTransition(task.status === "not_started" ? "implementing" : task.status, u.status)) {
    throw new AgentError(`Can't report ${u.status} after ${task.status}.`);
  }
  await admin.from("agent_tasks").update({ status: u.status, ...patch }).eq("id", task.id).eq("status", task.status);
  await event(admin, task.workspace_id, task.id, `status:${u.status}`, "agent", { pr_url: patch.pr_url ?? null, pr_state: patch.pr_state ?? null });
  if (u.status === "pr_created" && task.parent_task_id) {
    await admin.from("agent_tasks").update({ status: "pr_created", pr_url: patch.pr_url }).eq("id", task.parent_task_id).eq("status", "implementing");
  }
  return { accepted: true, pr_state: patch.pr_state ?? null };
}

/**
 * Whether Claude is connected to the workspace through the SignalForge connector: an
 * approved, unrevoked grant from Claude (the Claude Code channel's sign-in doesn't count).
 */
export async function claudeConnected(admin: SupabaseClient, workspaceId: string): Promise<boolean> {
  const { data: grants } = await admin.from("oauth_grants").select("client_id").eq("workspace_id", workspaceId).is("revoked_at", null);
  const ids = [...new Set((grants ?? []).map((g) => g.client_id as string))];
  if (!ids.length) return false;
  const { count } = await admin.from("oauth_clients").select("client_id", { count: "exact", head: true }).in("client_id", ids).neq("client_name", CHANNEL_CLIENT_NAME);
  return (count ?? 0) > 0;
}

/** Whether a SignalForge channel is signed in for the workspace, and listening right now (polled recently). */
export async function channelStatus(admin: SupabaseClient, workspaceId: string): Promise<{ signedIn: boolean; listening: boolean; lastUsedAt: string | null }> {
  const { data: grants } = await admin.from("oauth_grants").select("client_id, last_used_at").eq("workspace_id", workspaceId).is("revoked_at", null);
  const ids = [...new Set((grants ?? []).map((g) => g.client_id as string))];
  const { data: clients } = ids.length ? await admin.from("oauth_clients").select("client_id").in("client_id", ids).eq("client_name", CHANNEL_CLIENT_NAME) : { data: [] };
  const channel = new Set((clients ?? []).map((c) => c.client_id as string));
  const used = (grants ?? []).filter((g) => channel.has(g.client_id as string)).map((g) => g.last_used_at as string | null).filter((x): x is string => !!x).sort();
  const lastUsedAt = used.at(-1) ?? null;
  return { signedIn: (grants ?? []).some((g) => channel.has(g.client_id as string)), listening: channelListening(lastUsedAt), lastUsedAt };
}

/**
 * Tasks waiting for the user's own Claude Code session (the SignalForge channel polls
 * this): manual tasks not started yet (including ones queued before Claude was connected),
 * oldest first, from the last day only.
 */
export async function agentQueue(admin: SupabaseClient, who: McpPrincipal): Promise<QueuedTask[]> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data } = await admin.from("agent_tasks").select("id, stage, product_id, context, created_at")
    .eq("workspace_id", who.workspaceId).eq("execution", "manual").in("status", ["not_started", "awaiting_connection"]).gte("created_at", since)
    .order("created_at", { ascending: true }).limit(20);
  return (data ?? []).map((t) => {
    const c = t.context as { product?: { name?: string }; issue?: { title?: string; category?: string } };
    return {
      task_id: t.id as string, stage: t.stage as TaskStage, product_id: t.product_id as string, product: c.product?.name ?? "",
      issue: c.issue?.title ?? "", category: c.issue?.category ?? null, created_at: t.created_at as string,
    };
  });
}

/**
 * Pull requests opened in the repository since the investigation started (GitHub App).
 * Detection, not prevention: pushes without a pull request aren't visible this way.
 */
async function changesDuringInvestigation(admin: SupabaseClient, task: TaskRow): Promise<string[]> {
  const app = githubAppConfig();
  if (!task.repository_id) return [];
  const { data: repo } = await admin.from("agent_repositories").select("full_name, installation_id").eq("id", task.repository_id).maybeSingle();
  const { data: t } = await admin.from("agent_tasks").select("started_at, created_at").eq("id", task.id).maybeSingle();
  if (!app || !repo) return ["Pull requests opened during the investigation couldn't be checked (GitHub App not configured)."];
  const token = await installationToken(app, repo.installation_id as number);
  const prs = token ? await pullRequestsSince(token, repo.full_name as string, (t?.started_at ?? t?.created_at) as string) : null;
  if (!prs) return ["Pull requests opened during the investigation couldn't be checked."];
  return prs.map((p) => `Pull request #${p.number} (${p.headRef}) was opened during the investigation, which was supposed to make no changes.`);
}

/** Checks a reported PR with the GitHub App (read-only). Unverifiable without the App. */
async function verifyPr(installationId: number, fullName: string, number: number, branch: string | null): Promise<"open" | "closed" | "merged" | "unverified"> {
  const app = githubAppConfig();
  if (!app || !installationId) return "unverified";
  const token = await installationToken(app, installationId);
  if (!token) return "unverified";
  const pr = await getPullRequest(token, fullName, number);
  if (!pr) throw new AgentError("That pull request doesn't exist in the approved repository.");
  if (branch && pr.headRef !== branch) throw new AgentError("The pull request's branch doesn't match the reported branch.");
  return pr.state;
}

/** Marks tasks with no report after TASK_TIMEOUT_HOURS as failed (routines have no status API). */
export async function expireStaleTasks(admin: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - TASK_TIMEOUT_HOURS * 3_600_000).toISOString();
  const { data } = await admin.from("agent_tasks").update({ status: "failed", error: `No result received from Claude within ${TASK_TIMEOUT_HOURS} hours. Open the Claude Code session to see what happened.`, completed_at: new Date().toISOString() })
    .in("status", ["investigating", "implementing", "testing"]).lt("updated_at", cutoff).select("id, workspace_id");
  for (const t of data ?? []) await event(admin, t.workspace_id as string, t.id as string, "status:failed", "signalforge", { reason: "timeout" });
  return (data ?? []).length;
}

/** Test seam: the dev mock routine endpoint accepts fires only outside production. */
export const devRoutineAllowed = () => mockAllowed({ NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV });
