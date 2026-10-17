"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidSchema } from "@/lib/validation/schemas";
import { failure, invalid, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";
import { mockAllowed } from "@/lib/ai/mock";
import { TEST_CLASSIFIER } from "@/lib/ai/availability";
import { requestInvestigation, spikeSubject } from "@/lib/server/ai/investigate";
import { runWorker } from "@/lib/server/collection/worker";
import { workspaceAvailability } from "@/lib/server/ai/gateway";

// SignalForge Intelligence (SYSTEM A) actions. Customers don't connect an AI
// provider; these control what runs on SignalForge's own AI for their workspace.

const settingsPayload = z.object({
  workspaceId: z.uuid(),
  autoClassify: z.enum(["on", "off"]),
});

export async function updateAiSettingsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = settingsPayload.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  try {
    await requireWorkspaceRole(parsed.data.workspaceId, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const { error } = await createAdminClient().from("ai_settings").upsert({
    workspace_id: parsed.data.workspaceId, auto_classify: parsed.data.autoClassify === "on",
  }, { onConflict: "workspace_id" });
  if (error) {
    logServerError("aiSettings", error);
    return failure("Couldn't save AI settings.");
  }
  revalidatePath("/settings/ai");
  return { status: "success", message: "AI settings saved." };
}

/**
 * Development only: classify with the deterministic test classifier instead of a
 * model (no calls, no cost, labelled as test output). Unavailable in production.
 */
export async function toggleTestClassifierAction(_: ActionState, formData: FormData): Promise<ActionState> {
  if (!mockAllowed({ NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV })) return failure("Not available.");
  const workspaceId = uuidSchema.safeParse(formData.get("workspaceId"));
  const on = formData.get("on") === "true";
  if (!workspaceId.success) return failure("Invalid request.");
  try {
    await requireWorkspaceRole(workspaceId.data, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const admin = createAdminClient();
  const { data: row } = await admin.from("ai_provider_connections").select("id").eq("workspace_id", workspaceId.data).eq("provider", "signalforge").maybeSingle();
  if (on) {
    // Stored on the workspace's SignalForge row (no customer key involved).
    const { count: defaults } = await admin.from("ai_provider_connections").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId.data).eq("is_default", true);
    const { error } = row
      ? await admin.from("ai_provider_connections").update({ default_model: TEST_CLASSIFIER }).eq("id", row.id)
      : await admin.from("ai_provider_connections").insert({ workspace_id: workspaceId.data, provider: "signalforge", status: "valid", default_model: TEST_CLASSIFIER, is_default: (defaults ?? 0) === 0 });
    if (error) {
      logServerError("testClassifier", error);
      return failure("Couldn't switch to the test classifier.");
    }
  } else {
    await admin.from("ai_provider_connections").update({ default_model: null }).eq("workspace_id", workspaceId.data).eq("provider", "signalforge");
  }
  revalidatePath("/settings/ai");
  return { status: "success", message: on ? "Test classifier on: new mentions get test labels within a few minutes." : "Test classifier off." };
}

// ---------------------------------------------------------------------------
// On-demand analyses
// ---------------------------------------------------------------------------

const spikePayload = z.object({
  workspaceId: z.uuid(), productId: z.uuid(), granularity: z.enum(["day", "hour"]),
  // Empty = the spike covers all monitored platforms.
  platform: z.union([z.literal(""), z.string().regex(/^[a-z_]{2,32}$/)]).optional().transform((v) => v || null),
  // Keyword-level spikes: the keyword the spike was detected on (empty = product or platform level).
  keyword: z.string().trim().max(100).regex(/^[^|]*$/).optional().transform((v) => v || null),
  periodStart: z.iso.datetime({ offset: true }), force: z.enum(["true", "false"]).optional(),
});

export async function explainSpikeAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = spikePayload.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  const d = parsed.data;
  let userId: string;
  try {
    userId = (await requireWorkspaceRole(d.workspaceId, "member")).user.id;
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const admin = createAdminClient();
  const { data: product } = await admin.from("products").select("id").eq("id", d.productId).eq("workspace_id", d.workspaceId).maybeSingle();
  if (!product) return failure("Product not found.");
  try {
    const r = await requestInvestigation(admin, {
      workspaceId: d.workspaceId, productId: d.productId, kind: "spike_explanation",
      subjectKey: spikeSubject({ granularity: d.granularity, platform: d.platform, periodStart: d.periodStart, keyword: d.keyword }),
      title: `Spike on ${d.periodStart.slice(0, 10)}${d.keyword ? ` (“${d.keyword}”)` : ""}`, userId, force: d.force === "true",
    });
    if (r.status === "pending") after(() => runWorker({ budgetMs: 120_000, kinds: ["ai.investigate"] }).then(() => undefined));
    revalidatePath("/buzz");
    return { status: "success", message: r.status === "completed" ? "Already explained." : "Explanation requested. It appears here when ready." };
  } catch (e) {
    logServerError("explainSpike", e);
    return failure("Couldn't request the explanation.");
  }
}

const clusterPayload = z.object({ workspaceId: z.uuid(), clusterId: z.uuid(), force: z.enum(["true", "false"]).optional() });

export async function summarizeClusterAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = clusterPayload.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  let userId: string;
  try {
    userId = (await requireWorkspaceRole(parsed.data.workspaceId, "member")).user.id;
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const admin = createAdminClient();
  const { data: c } = await admin.from("feedback_clusters").select("id, product_id, title").eq("id", parsed.data.clusterId).eq("workspace_id", parsed.data.workspaceId).maybeSingle();
  if (!c) return failure("Issue not found.");
  try {
    const r = await requestInvestigation(admin, {
      workspaceId: parsed.data.workspaceId, productId: c.product_id as string, kind: "cluster_summary", subjectKey: c.id as string,
      clusterId: c.id as string, title: c.title as string, userId, force: parsed.data.force === "true",
    });
    if (r.status === "pending") after(() => runWorker({ budgetMs: 120_000, kinds: ["ai.investigate"] }).then(() => undefined));
    revalidatePath("/feedback");
    return { status: "success", message: "Summary requested. It appears here when ready." };
  } catch (e) {
    logServerError("summarizeCluster", e);
    return failure("Couldn't request the summary.");
  }
}

/**
 * Removes a customer API key saved by the earlier version of AI settings. Those keys
 * are no longer used: SignalForge Intelligence runs on SignalForge's own AI.
 */
export async function deleteAiKeyAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const workspaceId = uuidSchema.safeParse(formData.get("workspaceId"));
  const provider = z.enum(["anthropic", "openai", "gemini"]).safeParse(formData.get("provider"));
  if (!workspaceId.success || !provider.success) return failure("Invalid request.");
  try {
    await requireWorkspaceRole(workspaceId.data, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("ai_provider_connections")
    .select("id, secret_id")
    .eq("workspace_id", workspaceId.data)
    .eq("provider", provider.data)
    .maybeSingle();
  if (!conn) return failure("Nothing to remove.");
  const { error } = await admin.from("ai_provider_connections").delete().eq("id", conn.id);
  if (error) {
    logServerError("deleteAiKey", error);
    return failure("Couldn't remove the key.");
  }
  if (conn.secret_id) {
    await admin.from("credential_secrets").delete().eq("id", conn.secret_id).eq("workspace_id", workspaceId.data);
  }
  revalidatePath("/settings/ai");
  return { status: "success", message: "Key deleted. SignalForge no longer holds it." };
}

const classifyPayload = z.object({ workspaceId: z.uuid(), productId: z.uuid() });

/**
 * Classifies a product's waiting mentions now instead of at the next scheduler
 * turn. Goes through the job queue (leases, budgets, retries) like scheduled work.
 */
export async function classifyNowAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = classifyPayload.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  try {
    await requireWorkspaceRole(parsed.data.workspaceId, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const admin = createAdminClient();
  const { data: product } = await admin.from("products").select("id").eq("id", parsed.data.productId).eq("workspace_id", parsed.data.workspaceId).maybeSingle();
  if (!product) return failure("Product not found.");
  const a = await workspaceAvailability(admin, parsed.data.workspaceId);
  if (!a.ok) return failure(a.message);
  const { error } = await admin.rpc("svc_enqueue_job", {
    p_kind: "ai.classify", p_idempotency_key: `ai.classify:${parsed.data.productId}:now:${Math.floor(Date.now() / 60_000)}`,
    p_payload: { product_id: parsed.data.productId }, p_workspace_id: parsed.data.workspaceId, p_product_id: parsed.data.productId,
    p_run_after: new Date().toISOString(), p_priority: 40,
  });
  if (error) {
    logServerError("classifyNow", error);
    return failure("Couldn't start classification.");
  }
  after(() => runWorker({ budgetMs: 120_000, kinds: ["ai.classify"] }).then(() => undefined));
  return { status: "success", message: "Classifying waiting mentions. Labels and issues appear as each batch finishes." };
}
