import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { openCredential } from "@/lib/server/credentials";
import type { ConnectedSourceId } from "@/lib/sources/types";

/**
 * Customer connections for connected sources (Google Play: per workspace;
 * Discord: per product). Only "connected" rows count.
 */
const SCOPE: Record<ConnectedSourceId, "workspace" | "product"> = { google_play: "workspace", discord: "product" };

async function rowFor(admin: SupabaseClient, provider: ConnectedSourceId, productId: string, workspaceId: string) {
  let q = admin.from("integrations").select("id, config, secret_id, status").eq("workspace_id", workspaceId).eq("provider", provider).eq("status", "connected");
  q = SCOPE[provider] === "product" ? q.eq("product_id", productId) : q.is("product_id", null);
  const { data } = await q.maybeSingle();
  const row = data as { id: string; config: Record<string, unknown>; secret_id: string | null } | null;
  // Discord counts as connected once at least one channel is chosen.
  if (row && provider === "discord" && !(Array.isArray(row.config?.channels) && row.config.channels.length > 0)) return null;
  return row;
}

export async function connectedSources(admin: SupabaseClient, productId: string, workspaceId: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const p of Object.keys(SCOPE) as ConnectedSourceId[]) if (await rowFor(admin, p, productId, workspaceId)) out.add(p);
  return out;
}

/** The decrypted secret (if any) and config for one connected source. Server-side only; never logged. */
export async function connectionFor(admin: SupabaseClient, provider: ConnectedSourceId, productId: string, workspaceId: string) {
  const row = await rowFor(admin, provider, productId, workspaceId);
  if (!row) return null;
  let secret: string | null = null;
  if (row.secret_id) {
    const { data: s } = await admin.from("credential_secrets").select("ciphertext").eq("id", row.secret_id).eq("workspace_id", workspaceId).maybeSingle();
    if (s?.ciphertext) secret = openCredential(workspaceId, s.ciphertext as string);
  }
  return { integrationId: row.id, secret, config: row.config ?? {} };
}

export const isConnectedSource = (p: string): p is ConnectedSourceId => p in SCOPE;
