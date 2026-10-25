import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { storeSecret } from "@/lib/server/ai/secrets";
import { syncOptimizedQueries } from "./query-sync";
import { accessToken, parseServiceAccount, playPackage } from "@/lib/sources/google-play";
import { SourceError } from "@/lib/sources/errors";

type Fetch = typeof fetch;

/** Re-plans searches for the products a connection affects (workspace-wide or one product). */
async function resync(admin: SupabaseClient, workspaceId: string, productId: string | null) {
  const { data } = productId
    ? { data: [{ id: productId }] }
    : await admin.from("products").select("id").eq("workspace_id", workspaceId).is("archived_at", null).is("competitor_of", null);
  for (const p of data ?? []) {
    try {
      await syncOptimizedQueries(admin, p.id as string);
    } catch (e) {
      console.error(`[connections] resync ${p.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
}

async function upsertIntegration(admin: SupabaseClient, row: {
  workspace_id: string; product_id: string | null; provider: "google_play"; config: Record<string, unknown>;
  secret_id: string | null; external_account: string | null; connected_by: string; scopes: string[];
}) {
  let q = admin.from("integrations").select("id, secret_id").eq("workspace_id", row.workspace_id).eq("provider", row.provider);
  q = row.product_id ? q.eq("product_id", row.product_id) : q.is("product_id", null);
  const { data: existing } = await q.maybeSingle();
  const patch = { ...row, status: "connected", status_reason: null, last_error: null, last_error_at: null };
  const { error } = existing
    ? await admin.from("integrations").update(patch).eq("id", existing.id)
    : await admin.from("integrations").insert(patch);
  if (error) throw new Error(`save integration: ${error.message}`);
  // A replaced secret is deleted, not left behind.
  if (existing?.secret_id && existing.secret_id !== row.secret_id) await admin.from("credential_secrets").delete().eq("id", existing.secret_id);
}

/**
 * Connects Google Play for a workspace: checks the key, signs in to Google with it,
 * and (when a product has a Play URL) reads one page of reviews to prove access.
 * The key is stored encrypted; only its service account email is shown afterwards.
 */
export async function connectGooglePlay(admin: SupabaseClient, workspaceId: string, userId: string, keyJson: string, fetchImpl: Fetch = fetch): Promise<{ account: string; checkedApp: string | null }> {
  const key = parseServiceAccount(keyJson);
  const token = await accessToken(key, fetchImpl);
  const { data: products } = await admin.from("products").select("play_store_url").eq("workspace_id", workspaceId).is("archived_at", null).is("competitor_of", null);
  const pkg = (products ?? []).map((p) => playPackage(p.play_store_url as string | null)).find(Boolean) ?? null;
  if (pkg) {
    const res = await fetchImpl(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/reviews?maxResults=1`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) throw new SourceError("auth", `The service account signed in, but can't read reviews of ${pkg}. In Play Console → Users and permissions, invite ${key.client_email} with "View app information".`);
    if (res.status === 404) throw new SourceError("bad_request", `Google Play has no app ${pkg} for this account.`);
    if (!res.ok) throw new SourceError("transient", `Google Play check failed (${res.status}). Try again.`);
  }
  const secretId = await storeSecret(admin, workspaceId, "integration", JSON.stringify(key));
  if (!secretId) throw new Error("Couldn't store the key.");
  await upsertIntegration(admin, {
    workspace_id: workspaceId, product_id: null, provider: "google_play", config: {}, secret_id: secretId,
    external_account: key.client_email, connected_by: userId, scopes: ["androidpublisher (read reviews)"],
  });
  await resync(admin, workspaceId, null);
  return { account: key.client_email, checkedApp: pkg };
}

/** Removes a connection and its stored secret; searches using it stop. */
export async function disconnect(admin: SupabaseClient, workspaceId: string, provider: "google_play", productId: string | null) {
  let q = admin.from("integrations").select("id, secret_id").eq("workspace_id", workspaceId).eq("provider", provider);
  q = productId ? q.eq("product_id", productId) : q.is("product_id", null);
  const { data: row } = await q.maybeSingle();
  if (!row) return;
  await admin.from("integrations").update({ status: "not_connected", secret_id: null, config: {}, external_account: null }).eq("id", row.id);
  if (row.secret_id) await admin.from("credential_secrets").delete().eq("id", row.secret_id);
  await resync(admin, workspaceId, productId);
}
