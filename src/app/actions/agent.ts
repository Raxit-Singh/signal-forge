"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";
import { credentialsConfigured } from "@/lib/server/credentials";
import { parseFireUrl, ROUTINE_TOKEN_RE } from "@/lib/agent/routine";
import { installationToken, listInstallationRepos } from "@/lib/agent/github-app";
import { storeSecret } from "@/lib/server/ai/secrets";
import { revokeGrantForWorkspace, audit } from "@/lib/server/agent/oauth-store";
import {
  AgentError, approvePlan, cancelTask, devRoutineAllowed, githubAppConfig, startImplementation, startInvestigation,
} from "@/lib/server/agent/tasks";

// Developer agent (SYSTEM B) actions. Connecting Claude happens in Claude (custom
// connector + OAuth); these manage what SignalForge stores and the task workflow.

async function role(workspaceId: string, min: "member" | "admin") {
  try {
    return { userId: (await requireWorkspaceRole(workspaceId, min)).user.id };
  } catch (e) {
    return { error: failure(e instanceof AuthorizationError ? e.message : "Not allowed.") };
  }
}

const routinePayload = z.object({ workspaceId: z.uuid(), fireUrl: z.string().trim().max(300), token: z.string().trim().max(400) });

/** Saves the customer's Claude Code routine API trigger (URL + token; the token is encrypted). */
export async function saveRoutineAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const p = routinePayload.safeParse(Object.fromEntries(formData));
  if (!p.success) return failure("Invalid request.");
  const r = await role(p.data.workspaceId, "admin");
  if ("error" in r) return r.error!;
  const parsed = parseFireUrl(p.data.fireUrl, devRoutineAllowed());
  if (!parsed) return { status: "error", message: "Paste the routine URL exactly as Claude shows it (https://api.anthropic.com/v1/claude_code/routines/trig_…/fire).", fields: { fireUrl: "Not a routine API trigger URL." } };
  if (!ROUTINE_TOKEN_RE.test(p.data.token)) return { status: "error", message: "That doesn't look like a routine token (sk-ant-oat01-…).", fields: { token: "Not a routine token." } };
  if (!credentialsConfigured()) return failure("Credential storage isn't configured on this server. Nothing was saved.");
  const admin = createAdminClient();
  const secretId = await storeSecret(admin, p.data.workspaceId, "agent", p.data.token);
  if (!secretId) return failure("Couldn't store the token. Nothing was saved.");
  const { data: old } = await admin.from("agent_connections").select("secret_id").eq("workspace_id", p.data.workspaceId).maybeSingle();
  const { error } = await admin.from("agent_connections").upsert({
    workspace_id: p.data.workspaceId, routine_id: parsed.routineId, fire_url: p.data.fireUrl.trim(), secret_id: secretId,
    status: "unverified", last_error: null, created_by: r.userId,
  }, { onConflict: "workspace_id" });
  if (error) {
    await admin.from("credential_secrets").delete().eq("id", secretId);
    logServerError("saveRoutine", error);
    return failure("Couldn't save the routine.");
  }
  if (old?.secret_id) await admin.from("credential_secrets").delete().eq("id", old.secret_id).eq("workspace_id", p.data.workspaceId);
  await audit(admin, p.data.workspaceId, r.userId!, "agent.routine_saved", parsed.routineId, {});
  revalidatePath("/settings/agent");
  return { status: "success", message: "Routine saved. It is used the first time you investigate an issue." };
}

export async function removeRoutineAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const workspaceId = z.uuid().safeParse(formData.get("workspaceId"));
  if (!workspaceId.success) return failure("Invalid request.");
  const r = await role(workspaceId.data, "admin");
  if ("error" in r) return r.error!;
  const admin = createAdminClient();
  const { data: conn } = await admin.from("agent_connections").select("secret_id").eq("workspace_id", workspaceId.data).maybeSingle();
  await admin.from("agent_connections").delete().eq("workspace_id", workspaceId.data);
  if (conn?.secret_id) await admin.from("credential_secrets").delete().eq("id", conn.secret_id).eq("workspace_id", workspaceId.data);
  await audit(admin, workspaceId.data, r.userId!, "agent.routine_removed", workspaceId.data, {});
  revalidatePath("/settings/agent");
  return { status: "success", message: "Routine removed. SignalForge no longer holds its token." };
}

export async function revokeClaudeAccessAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ workspaceId: z.uuid(), grantId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!p.success) return failure("Invalid request.");
  const r = await role(p.data.workspaceId, "admin");
  if ("error" in r) return r.error!;
  const ok = await revokeGrantForWorkspace(createAdminClient(), p.data.grantId, p.data.workspaceId);
  revalidatePath("/settings/agent");
  return ok ? { status: "success", message: "Access revoked. That Claude connection can no longer read this workspace." } : failure("Connection not found.");
}

export async function selectRepositoryAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ workspaceId: z.uuid(), productId: z.uuid(), installationId: z.coerce.number().int().positive(), repoId: z.coerce.number().int().positive() })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) return failure("Invalid request.");
  const r = await role(p.data.workspaceId, "admin");
  if ("error" in r) return r.error!;
  const app = githubAppConfig();
  if (!app) return failure("The GitHub App isn't configured on this server.");
  const admin = createAdminClient();
  const [{ data: inst }, { data: product }] = await Promise.all([
    admin.from("github_installations").select("installation_id").eq("workspace_id", p.data.workspaceId).eq("installation_id", p.data.installationId).is("revoked_at", null).maybeSingle(),
    admin.from("products").select("id").eq("id", p.data.productId).eq("workspace_id", p.data.workspaceId).maybeSingle(),
  ]);
  if (!inst || !product) return failure("Installation or product not found in this workspace.");
  // The repository must be one the installation can actually access (checked with GitHub now).
  const token = await installationToken(app, p.data.installationId);
  const repos = token ? await listInstallationRepos(token) : null;
  const repo = repos?.find((x) => x.id === p.data.repoId);
  if (!repo) return failure("SignalForge's GitHub App can't access that repository.");
  const { error } = await admin.from("agent_repositories").upsert({
    workspace_id: p.data.workspaceId, product_id: p.data.productId, installation_id: p.data.installationId, repo_id: repo.id,
    full_name: repo.fullName, default_branch: repo.defaultBranch, private: repo.private, created_by: r.userId,
  }, { onConflict: "product_id" });
  if (error) {
    logServerError("selectRepository", error);
    return failure("Couldn't save the repository.");
  }
  await audit(admin, p.data.workspaceId, r.userId!, "agent.repository_selected", p.data.productId, { repository: repo.fullName });
  revalidatePath("/settings/agent");
  return { status: "success", message: `${repo.fullName} linked.` };
}

export async function removeRepositoryAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ workspaceId: z.uuid(), productId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!p.success) return failure("Invalid request.");
  const r = await role(p.data.workspaceId, "admin");
  if ("error" in r) return r.error!;
  await createAdminClient().from("agent_repositories").delete().eq("product_id", p.data.productId).eq("workspace_id", p.data.workspaceId);
  revalidatePath("/settings/agent");
  return { status: "success", message: "Repository unlinked." };
}

const taskPayload = z.object({ workspaceId: z.uuid(), taskId: z.uuid() });

async function run(fn: () => Promise<unknown>, ok: string, paths: string[]): Promise<ActionState> {
  try {
    await fn();
    for (const p of paths) revalidatePath(p);
    return { status: "success", message: ok };
  } catch (e) {
    if (e instanceof AgentError) return failure(e.message);
    logServerError("agent", e);
    return failure("Something went wrong. Nothing was changed.");
  }
}

export async function investigateWithClaudeAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ workspaceId: z.uuid(), clusterId: z.uuid(), acknowledge: z.literal("yes").optional() }).safeParse(Object.fromEntries(formData));
  if (!p.success) return failure("Invalid request.");
  const r = await role(p.data.workspaceId, "member");
  if ("error" in r) return r.error!;
  let msg = "";
  const res = await run(async () => {
    const t = await startInvestigation(createAdminClient(), { workspaceId: p.data.workspaceId, clusterId: p.data.clusterId, userId: r.userId!, acknowledged: p.data.acknowledge === "yes" });
    msg = t.existing ? "An investigation for this issue is already in progress."
      : t.status === "investigating" ? "Claude Code started the investigation (instructed not to change code)."
      : t.status === "failed" ? "Claude Code couldn't be started — see the task."
      : "Investigation task created — see the next step below.";
  }, "", ["/feedback"]);
  return res.status === "success" ? { status: "success", message: msg } : res;
}

export async function approvePlanAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const p = taskPayload.extend({ planHash: z.string().regex(/^[0-9a-f]{64}$/) }).safeParse(Object.fromEntries(formData));
  if (!p.success) return failure("Invalid request.");
  const r = await role(p.data.workspaceId, "admin");
  if ("error" in r) return r.error!;
  return run(() => approvePlan(createAdminClient(), { workspaceId: p.data.workspaceId, taskId: p.data.taskId, planHash: p.data.planHash, userId: r.userId! }),
    "Plan approved. Start the implementation when you're ready.", ["/feedback", "/settings/agent"]);
}

export async function startImplementationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const p = taskPayload.safeParse(Object.fromEntries(formData));
  if (!p.success) return failure("Invalid request.");
  const r = await role(p.data.workspaceId, "admin");
  if ("error" in r) return r.error!;
  return run(() => startImplementation(createAdminClient(), { workspaceId: p.data.workspaceId, investigationTaskId: p.data.taskId, userId: r.userId! }),
    "Implementation started. Claude works on a new branch and opens a pull request for your review.", ["/feedback", "/settings/agent"]);
}

export async function cancelTaskAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const p = taskPayload.safeParse(Object.fromEntries(formData));
  if (!p.success) return failure("Invalid request.");
  const r = await role(p.data.workspaceId, "member");
  if ("error" in r) return r.error!;
  return run(() => cancelTask(createAdminClient(), { workspaceId: p.data.workspaceId, taskId: p.data.taskId, userId: r.userId! }),
    "Task cancelled. Claude's further reports for it are refused.", ["/feedback", "/settings/agent"]);
}
