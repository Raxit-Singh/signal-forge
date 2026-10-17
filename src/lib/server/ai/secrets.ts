import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openCredential, sealCredential } from "@/lib/server/credentials";

/** Decrypts a workspace-bound credential. Never log or return the result to a browser. */
export async function decryptKey(admin: SupabaseClient, workspaceId: string, secretId: string): Promise<string | null> {
  const { data } = await admin.from("credential_secrets").select("ciphertext").eq("id", secretId).eq("workspace_id", workspaceId).maybeSingle();
  if (!data?.ciphertext) return null;
  try {
    return openCredential(workspaceId, data.ciphertext as string);
  } catch {
    return null;
  }
}

/** Encrypts and stores a workspace-bound credential; returns its id. */
export async function storeSecret(admin: SupabaseClient, workspaceId: string, purpose: "agent" | "integration", plaintext: string): Promise<string | null> {
  const sealed = sealCredential(workspaceId, plaintext);
  const { data, error } = await admin.from("credential_secrets")
    .insert({ workspace_id: workspaceId, purpose, ciphertext: sealed.ciphertext, key_version: sealed.keyVersion })
    .select("id").single();
  return error || !data ? null : (data.id as string);
}
