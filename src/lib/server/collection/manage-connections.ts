import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server/env";
import { storeSecret } from "@/lib/server/ai/secrets";
import { syncOptimizedQueries } from "./query-sync";
import { accessToken, parseServiceAccount, playPackage } from "@/lib/sources/google-play";
import { DISCORD_API, parseDiscordConfig } from "@/lib/sources/discord";
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
  workspace_id: string; product_id: string | null; provider: "google_play" | "discord"; config: Record<string, unknown>;
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
export async function disconnect(admin: SupabaseClient, workspaceId: string, provider: "google_play" | "discord", productId: string | null) {
  let q = admin.from("integrations").select("id, secret_id").eq("workspace_id", workspaceId).eq("provider", provider);
  q = productId ? q.eq("product_id", productId) : q.is("product_id", null);
  const { data: row } = await q.maybeSingle();
  if (!row) return;
  await admin.from("integrations").update({ status: "not_connected", secret_id: null, config: {}, external_account: null }).eq("id", row.id);
  if (row.secret_id) await admin.from("credential_secrets").delete().eq("id", row.secret_id);
  await resync(admin, workspaceId, productId);
}

// ------------------------------------------------------------------ Discord

export function discordConfig() {
  const env = serverEnv();
  return env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_BOT_TOKEN
    ? { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET, botToken: env.DISCORD_BOT_TOKEN }
    : null;
}

/**
 * Completes Discord's bot authorization: the code exchange returns the server the
 * admin actually added the bot to. The guild id in the redirect URL is never
 * trusted (anyone could edit it to point at another customer's server).
 */
export async function exchangeDiscordCode(code: string, redirectUri: string, fetchImpl: Fetch = fetch): Promise<{ id: string; name: string }> {
  const cfg = discordConfig();
  if (!cfg) throw new SourceError("auth", "Discord isn't configured on this server.");
  const res = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new SourceError("auth", `Discord didn't confirm the installation (${res.status}). Try adding the bot again.`);
  const body = (await res.json()) as { guild?: { id?: string; name?: string } };
  if (!body.guild?.id || !/^\d{15,22}$/.test(body.guild.id)) throw new SourceError("auth", "Discord didn't say which server the bot was added to.");
  return { id: body.guild.id, name: String(body.guild.name ?? "Discord server").slice(0, 100) };
}

/** Text and announcement channels the bot can see (type 0 and 5). */
export async function discordChannels(guildId: string, fetchImpl: Fetch = fetch): Promise<Array<{ id: string; name: string }>> {
  const cfg = discordConfig();
  if (!cfg) throw new SourceError("auth", "Discord isn't configured on this server.");
  const res = await fetchImpl(`${DISCORD_API}/guilds/${guildId}/channels`, { headers: { Authorization: `Bot ${cfg.botToken}` }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 403 || res.status === 404) throw new SourceError("auth", "SignalForge's bot isn't in that server any more.");
  if (!res.ok) throw new SourceError("transient", `Discord request failed (${res.status}).`);
  const list = (await res.json()) as Array<{ id: string; name: string; type: number; position?: number }>;
  return list.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((c) => ({ id: c.id, name: c.name.slice(0, 100) }));
}

export async function connectDiscord(admin: SupabaseClient, workspaceId: string, productId: string, userId: string, guild: { id: string; name: string }) {
  const available = await discordChannels(guild.id);
  await upsertIntegration(admin, {
    workspace_id: workspaceId, product_id: productId, provider: "discord",
    config: { guild_id: guild.id, guild_name: guild.name, channels: [], available_channels: available, mode: "all" },
    secret_id: null, external_account: guild.name, connected_by: userId, scopes: ["bot: View Channels, Read Message History"],
  });
  return available.length;
}

/** Saves which channels to read; only channels the bot can see in the connected server are accepted. */
export async function setDiscordChannels(admin: SupabaseClient, workspaceId: string, productId: string, channelIds: string[], mode: "all" | "keywords") {
  const { data: row } = await admin.from("integrations").select("id, config").eq("workspace_id", workspaceId).eq("product_id", productId).eq("provider", "discord").maybeSingle();
  const cfg = parseDiscordConfig(row?.config as Record<string, unknown> | null);
  if (!row || !cfg) throw new SourceError("auth", "Discord isn't connected for this product.");
  const available = await discordChannels(cfg.guild_id);
  const chosen = available.filter((c) => channelIds.includes(c.id)).slice(0, 25);
  await admin.from("integrations").update({ config: { ...(row.config as object), channels: chosen, available_channels: available, mode } }).eq("id", row.id);
  await resync(admin, workspaceId, productId);
  return chosen.length;
}
