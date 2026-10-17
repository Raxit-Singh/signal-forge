import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACCESS_TTL_SECONDS, CODE_TTL_SECONDS, REFRESH_TTL_SECONDS, hashToken, randomToken, redirectMatches, verifyPkce,
} from "@/lib/agent/oauth";

// Persistence for the MCP OAuth authorization server. Only hashes of codes and
// tokens are stored; plaintext tokens exist only in the response to the client.

export async function registerClient(admin: SupabaseClient, name: string, redirectUris: string[]) {
  const clientId = randomToken("sfc_", 24);
  const { error } = await admin.from("oauth_clients").insert({ client_id: clientId, client_name: name, redirect_uris: redirectUris });
  if (error) throw new Error(`register client: ${error.message}`);
  return clientId;
}

export async function getClient(admin: SupabaseClient, clientId: string) {
  const { data } = await admin.from("oauth_clients").select("client_id, client_name, redirect_uris").eq("client_id", clientId).maybeSingle();
  return data as { client_id: string; client_name: string; redirect_uris: string[] } | null;
}

/** Records consent and returns a one-time authorization code. */
export async function issueCode(admin: SupabaseClient, o: { clientId: string; userId: string; workspaceId: string; scopes: string[]; resource: string; redirectUri: string; codeChallenge: string }) {
  const { data: grant, error } = await admin.from("oauth_grants").insert({
    client_id: o.clientId, user_id: o.userId, workspace_id: o.workspaceId, scopes: o.scopes, resource: o.resource,
  }).select("id").single();
  if (error || !grant) throw new Error(`create grant: ${error?.message}`);
  const code = randomToken("sfa_");
  const { error: cErr } = await admin.from("oauth_codes").insert({
    code_hash: hashToken(code), grant_id: grant.id, redirect_uri: o.redirectUri, code_challenge: o.codeChallenge,
    expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
  });
  if (cErr) throw new Error(`create code: ${cErr.message}`);
  await audit(admin, o.workspaceId, o.userId, "oauth.grant_created", grant.id as string, { client_id: o.clientId, scopes: o.scopes });
  return code;
}

type TokenError = { error: "invalid_grant" | "invalid_client" | "invalid_request" | "unsupported_grant_type"; error_description: string };
type TokenSet = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

async function mintTokens(admin: SupabaseClient, grantId: string, scopes: string[]): Promise<TokenSet> {
  const access = randomToken("sfat_");
  const refresh = randomToken("sfrt_");
  const now = Date.now();
  const { error } = await admin.from("oauth_tokens").insert([
    { token_hash: hashToken(access), grant_id: grantId, kind: "access", expires_at: new Date(now + ACCESS_TTL_SECONDS * 1000).toISOString() },
    { token_hash: hashToken(refresh), grant_id: grantId, kind: "refresh", expires_at: new Date(now + REFRESH_TTL_SECONDS * 1000).toISOString() },
  ]);
  if (error) throw new Error(`mint tokens: ${error.message}`);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_SECONDS, refresh_token: refresh, scope: scopes.join(" ") };
}

async function revokeGrant(admin: SupabaseClient, grantId: string, reason: string) {
  const now = new Date().toISOString();
  await admin.from("oauth_grants").update({ revoked_at: now }).eq("id", grantId).is("revoked_at", null);
  await admin.from("oauth_tokens").update({ revoked_at: now }).eq("grant_id", grantId).is("revoked_at", null);
  const { data: g } = await admin.from("oauth_grants").select("workspace_id, user_id").eq("id", grantId).maybeSingle();
  if (g) await audit(admin, g.workspace_id as string, g.user_id as string, "oauth.grant_revoked", grantId, { reason });
}

export async function exchangeCode(admin: SupabaseClient, p: { code: string; clientId: string; redirectUri: string; verifier: string }): Promise<TokenSet | TokenError> {
  const { data: row } = await admin.from("oauth_codes").select("code_hash, grant_id, redirect_uri, code_challenge, expires_at, used_at").eq("code_hash", hashToken(p.code)).maybeSingle();
  if (!row) return { error: "invalid_grant", error_description: "Unknown or expired code." };
  const { data: grant } = await admin.from("oauth_grants").select("id, client_id, scopes, revoked_at").eq("id", row.grant_id).maybeSingle();
  if (!grant || grant.revoked_at) return { error: "invalid_grant", error_description: "The authorization was revoked." };
  if (row.used_at) {
    // A code used twice means it leaked: revoke everything issued from it (RFC 6749 §4.1.2).
    await revokeGrant(admin, grant.id as string, "authorization code reuse");
    return { error: "invalid_grant", error_description: "Code already used." };
  }
  // Mark used first (single use even under concurrent requests).
  const { data: claimed } = await admin.from("oauth_codes").update({ used_at: new Date().toISOString() }).eq("code_hash", row.code_hash).is("used_at", null).select("code_hash");
  if (!claimed?.length) return { error: "invalid_grant", error_description: "Code already used." };
  if (Date.parse(row.expires_at as string) < Date.now()) return { error: "invalid_grant", error_description: "Code expired." };
  if (grant.client_id !== p.clientId) return { error: "invalid_grant", error_description: "Code was issued to another client." };
  if (!redirectMatches([row.redirect_uri as string], p.redirectUri)) return { error: "invalid_grant", error_description: "redirect_uri mismatch." };
  if (!verifyPkce(p.verifier, row.code_challenge as string)) return { error: "invalid_grant", error_description: "PKCE verification failed." };
  return mintTokens(admin, grant.id as string, grant.scopes as string[]);
}

export async function refresh(admin: SupabaseClient, p: { refreshToken: string; clientId: string }): Promise<TokenSet | TokenError> {
  const { data: row } = await admin.from("oauth_tokens").select("token_hash, grant_id, kind, expires_at, revoked_at, replaced_at").eq("token_hash", hashToken(p.refreshToken)).maybeSingle();
  if (!row || row.kind !== "refresh") return { error: "invalid_grant", error_description: "Unknown refresh token." };
  const { data: grant } = await admin.from("oauth_grants").select("id, client_id, scopes, revoked_at").eq("id", row.grant_id).maybeSingle();
  if (!grant || grant.revoked_at || row.revoked_at) return { error: "invalid_grant", error_description: "The authorization was revoked." };
  if (grant.client_id !== p.clientId) return { error: "invalid_grant", error_description: "Token was issued to another client." };
  if (row.replaced_at) {
    // Reuse of a rotated refresh token: treat as theft and revoke the grant.
    await revokeGrant(admin, grant.id as string, "refresh token reuse");
    return { error: "invalid_grant", error_description: "Refresh token already used." };
  }
  if (Date.parse(row.expires_at as string) < Date.now()) return { error: "invalid_grant", error_description: "Refresh token expired." };
  const { data: claimed } = await admin.from("oauth_tokens").update({ replaced_at: new Date().toISOString() }).eq("token_hash", row.token_hash).is("replaced_at", null).select("token_hash");
  if (!claimed?.length) return { error: "invalid_grant", error_description: "Refresh token already used." };
  return mintTokens(admin, grant.id as string, grant.scopes as string[]);
}

/** RFC 7009: revoking any token of a grant revokes the grant. Unknown tokens are not an error. */
export async function revokeToken(admin: SupabaseClient, token: string) {
  const { data: row } = await admin.from("oauth_tokens").select("grant_id").eq("token_hash", hashToken(token)).maybeSingle();
  if (row) await revokeGrant(admin, row.grant_id as string, "client revocation");
}

export async function revokeGrantForWorkspace(admin: SupabaseClient, grantId: string, workspaceId: string) {
  const { data } = await admin.from("oauth_grants").select("id").eq("id", grantId).eq("workspace_id", workspaceId).maybeSingle();
  if (!data) return false;
  await revokeGrant(admin, grantId, "revoked in SignalForge");
  return true;
}

export interface McpPrincipal {
  grantId: string;
  clientId: string;
  userId: string;
  workspaceId: string;
  scopes: string[];
  expiresAt: number;
}

/**
 * Validates an access token: known, not expired, not revoked, grant active, and the
 * user is STILL a member of the workspace (leaving a workspace cuts access at once).
 */
export async function validateAccessToken(admin: SupabaseClient, token: string): Promise<McpPrincipal | null> {
  if (!/^sfat_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const { data: row } = await admin.from("oauth_tokens").select("grant_id, kind, expires_at, revoked_at").eq("token_hash", hashToken(token)).maybeSingle();
  if (!row || row.kind !== "access" || row.revoked_at || Date.parse(row.expires_at as string) < Date.now()) return null;
  const { data: grant } = await admin.from("oauth_grants").select("id, client_id, user_id, workspace_id, scopes, revoked_at, last_used_at").eq("id", row.grant_id).maybeSingle();
  if (!grant || grant.revoked_at) return null;
  const { data: member } = await admin.from("workspace_members").select("role").eq("workspace_id", grant.workspace_id).eq("user_id", grant.user_id).maybeSingle();
  if (!member) return null;
  // Record use at most once a minute.
  if (!grant.last_used_at || Date.now() - Date.parse(grant.last_used_at as string) > 60_000) {
    await admin.from("oauth_grants").update({ last_used_at: new Date().toISOString() }).eq("id", grant.id);
    await admin.from("oauth_clients").update({ last_used_at: new Date().toISOString() }).eq("client_id", grant.client_id);
  }
  return {
    grantId: grant.id as string, clientId: grant.client_id as string, userId: grant.user_id as string,
    workspaceId: grant.workspace_id as string, scopes: grant.scopes as string[], expiresAt: Math.floor(Date.parse(row.expires_at as string) / 1000),
  };
}

export async function audit(admin: SupabaseClient, workspaceId: string, actorId: string | null, action: string, entityId: string, metadata: Record<string, unknown>) {
  await admin.from("audit_logs").insert({ workspace_id: workspaceId, actor_id: actorId, action, entity_type: "developer_agent", entity_id: entityId, metadata });
}
