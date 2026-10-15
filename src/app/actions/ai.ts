"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiKeySchema, uuidSchema } from "@/lib/validation/schemas";
import { checkKeyShape, keyHint } from "@/lib/domain/ai-providers";
import { credentialsConfigured, sealCredential } from "@/lib/server/credentials";
import { failure, invalid, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";

const payload = aiKeySchema.extend({
  workspaceId: z.uuid(),
  returnTo: z.string().regex(/^\/onboarding\/[0-9a-f-]{36}\/ai$|^\/settings\/ai$/).default("/settings/ai"),
});

/**
 * Stores a BYOK API key. The key is encrypted (AES-256-GCM, bound to the
 * workspace) before it reaches the database, stored in a table no client role
 * can read, and only its last 4 characters are ever shown again.
 *
 * Milestone 4 adds a live validation call; until then keys are "unverified".
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

  revalidatePath(returnTo);
  return { status: "success", message: `Key saved (ending …${row.key_hint}). It will be verified before first use.` };
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
