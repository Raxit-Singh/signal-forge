"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiKeySchema, uuidSchema } from "@/lib/validation/schemas";
import { checkKeyShape, keyHint } from "@/lib/domain/ai-providers";
import { credentialsConfigured, sealCredential } from "@/lib/server/credentials";
import { failure, invalid, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";
import { anthropicClient, geminiClient, openaiClient } from "@/lib/ai/providers";
import { mockAllowed } from "@/lib/ai/mock";
import { TEST_CLASSIFIER } from "@/lib/ai/availability";
import { decryptKey } from "@/lib/server/ai/gateway";
import { requestInvestigation, spikeSubject } from "@/lib/server/ai/investigate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runWorker } from "@/lib/server/collection/worker";
import { workspaceAvailability } from "@/lib/server/ai/gateway";

const payload = aiKeySchema.extend({
  workspaceId: z.uuid(),
  returnTo: z.string().regex(/^\/onboarding\/[0-9a-f-]{36}\/ai$|^\/settings\/ai$/).default("/settings/ai"),
});

/**
 * Stores a BYOK API key. The key is encrypted (AES-256-GCM, bound to the
 * workspace) before it reaches the database, stored in a table no client role
 * can read, and only its last 4 characters are ever shown again.
 *
 * The key is then verified with a token-free call (listing models), so a typo
 * or revoked key is caught before any analysis runs.
 */
export async function saveAiKeyAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = payload.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { workspaceId, provider, returnTo } = parsed.data;

  try {
    await requireWorkspaceRole(workspaceId, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }

  const shape = checkKeyShape(provider, parsed.data.apiKey);
  if (!shape.ok) return { status: "error", message: shape.error, fields: { apiKey: shape.error } };
  const model = provider === "anthropic" ? null : parsed.data.model;
  if (provider !== "anthropic" && !model) {
    const error = "Enter the model to use with this key.";
    return { status: "error", message: error, fields: { model: error } };
  }
  if (!credentialsConfigured()) {
    logServerError("saveAiKey", "CREDENTIALS_ENCRYPTION_KEY missing or invalid");
    return failure("Key storage isn't configured on this server yet. Your key was not saved.");
  }

  const admin = createAdminClient();
  const sealed = sealCredential(workspaceId, shape.key);

  const { data: existing } = await admin
    .from("ai_provider_connections")
    .select("id, secret_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();

  const { data: secret, error: secretErr } = await admin
    .from("credential_secrets")
    .insert({ workspace_id: workspaceId, purpose: "ai_provider", ciphertext: sealed.ciphertext, key_version: sealed.keyVersion })
    .select("id")
    .single();
  if (secretErr) {
    logServerError("saveAiKey.secret", secretErr);
    return failure("Couldn't store the key. It was not saved.");
  }

  const { count: defaults } = await admin
    .from("ai_provider_connections")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("is_default", true);

  const row = {
    workspace_id: workspaceId,
    provider,
    secret_id: secret.id,
    key_hint: keyHint(shape.key),
    status: "unverified",
    validated_at: null,
    default_model: model,
    last_error: null,
    is_default: existing ? undefined : (defaults ?? 0) === 0,
  };
  const { error: connErr } = existing
    ? await admin.from("ai_provider_connections").update(row).eq("id", existing.id)
    : await admin.from("ai_provider_connections").insert(row);
  if (connErr) {
    await admin.from("credential_secrets").delete().eq("id", secret.id).eq("workspace_id", workspaceId);
    logServerError("saveAiKey.connection", connErr);
    return failure("Couldn't store the key. It was not saved.");
  }

  // Rotation: the previous ciphertext is no longer referenced; remove it.
  if (existing?.secret_id) {
    await admin.from("credential_secrets").delete().eq("id", existing.secret_id).eq("workspace_id", workspaceId);
  }

  const check = await verifyKey(admin, workspaceId, provider, shape.key, model);
  revalidatePath(returnTo);
  return check.ok
    ? { status: "success", message: `Key saved (ending …${row.key_hint}) and verified.` }
    : { status: "error", message: `Key saved (ending …${row.key_hint}) but not verified: ${check.message}` };
}

/** Token-free check (lists models). Records the result on the connection. */
async function verifyKey(admin: SupabaseClient, workspaceId: string, provider: "anthropic" | "openai" | "gemini", key: string, model: string | null) {
  const client = provider === "anthropic" ? anthropicClient(key) : provider === "openai" ? openaiClient(key, model ?? "") : geminiClient(key, model ?? "");
  const r = await client.validate();
  let ok = r.ok;
  let message = r.ok ? "" : r.kind === "auth" ? "the provider rejected this key." : r.message;
  if (r.ok && model && !r.models.includes(model.replace(/^models\//, ""))) {
    ok = false;
    message = `this key has no access to the model "${model}".`;
  }
  // Network trouble isn't proof the key is wrong: leave it unverified so it can be retried.
  const status = ok ? "valid" : !r.ok && (r.kind === "unavailable" || r.kind === "rate_limited") ? "unverified" : "invalid";
  await admin.from("ai_provider_connections").update({
    status, validated_at: ok ? new Date().toISOString() : null, last_error: ok ? null : message.slice(0, 300),
  }).eq("workspace_id", workspaceId).eq("provider", provider);
  return { ok, message };
}

export async function verifyAiKeyAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const workspaceId = uuidSchema.safeParse(formData.get("workspaceId"));
  const provider = z.enum(["anthropic", "openai", "gemini"]).safeParse(formData.get("provider"));
  if (!workspaceId.success || !provider.success) return failure("Invalid request.");
  try {
    await requireWorkspaceRole(workspaceId.data, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const admin = createAdminClient();
  const { data: conn } = await admin.from("ai_provider_connections").select("secret_id, default_model")
    .eq("workspace_id", workspaceId.data).eq("provider", provider.data).maybeSingle();
  if (!conn?.secret_id) return failure("No key is saved for this provider.");
  const key = await decryptKey(admin, workspaceId.data, conn.secret_id as string);
  if (!key) return failure("The saved key couldn't be read. Save it again.");
  const r = await verifyKey(admin, workspaceId.data, provider.data, key, (conn.default_model as string | null) ?? null);
  revalidatePath("/settings/ai");
  return r.ok ? { status: "success", message: "Key verified." } : failure(`Not verified: ${r.message}`);
}

export async function setDefaultAiProviderAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const workspaceId = uuidSchema.safeParse(formData.get("workspaceId"));
  const provider = z.enum(["anthropic", "openai", "gemini", "signalforge"]).safeParse(formData.get("provider"));
  if (!workspaceId.success || !provider.success) return failure("Invalid request.");
  try {
    await requireWorkspaceRole(workspaceId.data, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const admin = createAdminClient();
  await admin.from("ai_provider_connections").update({ is_default: false }).eq("workspace_id", workspaceId.data).eq("is_default", true);
  const { error } = await admin.from("ai_provider_connections").update({ is_default: true }).eq("workspace_id", workspaceId.data).eq("provider", provider.data);
  if (error) {
    logServerError("setDefaultAi", error);
    return failure("Couldn't change the provider.");
  }
  revalidatePath("/settings/ai");
  return { status: "success", message: "AI provider changed." };
}

const settingsPayload = z.object({
  workspaceId: z.uuid(),
  autoClassify: z.enum(["on", "off"]),
  byokCap: z.string().trim().regex(/^\d{0,10}$/, { error: "Enter a whole number of tokens, or leave empty for no cap." }),
});

export async function updateAiSettingsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = settingsPayload.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  try {
    await requireWorkspaceRole(parsed.data.workspaceId, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const cap = parsed.data.byokCap ? Number(parsed.data.byokCap) : null;
  if (cap !== null && cap < 1000) return { status: "error", message: "Use at least 1,000 tokens.", fields: { byokCap: "Use at least 1,000 tokens." } };
  const { error } = await createAdminClient().from("ai_settings").upsert({
    workspace_id: parsed.data.workspaceId, auto_classify: parsed.data.autoClassify === "on", byok_monthly_token_cap: cap,
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
  const { data: rows } = await admin.from("ai_provider_connections").select("provider").eq("workspace_id", workspaceId.data);
  const hasCredits = (rows ?? []).some((r) => r.provider === "signalforge");
  if (on) {
    await admin.from("ai_provider_connections").update({ is_default: false }).eq("workspace_id", workspaceId.data).eq("is_default", true);
    const { error } = hasCredits
      ? await admin.from("ai_provider_connections").update({ default_model: TEST_CLASSIFIER, is_default: true }).eq("workspace_id", workspaceId.data).eq("provider", "signalforge")
      : await admin.from("ai_provider_connections").insert({ workspace_id: workspaceId.data, provider: "signalforge", status: "valid", default_model: TEST_CLASSIFIER, is_default: true });
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
  platform: z.string().regex(/^[a-z_]{2,32}$/).optional().transform((v) => v || null),
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
      subjectKey: spikeSubject({ granularity: d.granularity, platform: d.platform, periodStart: d.periodStart }),
      title: `Spike on ${d.periodStart.slice(0, 10)}`, userId, force: d.force === "true",
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

export async function chooseSignalForgeCreditsAction(formData: FormData): Promise<void> {
  const workspaceId = uuidSchema.safeParse(formData.get("workspaceId"));
  const next = String(formData.get("next") ?? "/settings/ai");
  if (!workspaceId.success) redirect("/overview");
  try {
    await requireWorkspaceRole(workspaceId.data, "admin");
  } catch {
    redirect("/overview");
  }
  const admin = createAdminClient();
  const { count: defaults } = await admin
    .from("ai_provider_connections")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId.data)
    .eq("is_default", true);
  const { error } = await admin.from("ai_provider_connections").upsert(
    {
      workspace_id: workspaceId.data,
      provider: "signalforge",
      status: "valid",
      is_default: (defaults ?? 0) === 0,
    },
    { onConflict: "workspace_id,provider", ignoreDuplicates: true },
  );
  if (error) logServerError("useCredits", error);
  redirect(/^\/(onboarding\/[0-9a-f-]{36}\/scan|settings\/ai)$/.test(next) ? next : "/settings/ai");
}

export async function deleteAiKeyAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const workspaceId = uuidSchema.safeParse(formData.get("workspaceId"));
  const provider = z.enum(["anthropic", "openai", "gemini", "signalforge"]).safeParse(formData.get("provider"));
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
