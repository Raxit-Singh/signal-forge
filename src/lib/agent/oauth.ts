// OAuth 2.1 authorization server rules for the SignalForge remote MCP server (pure).
//
// Implements what Claude's connector client documents (claude.com/docs/connectors/
// building/authentication): RFC 9728 protected-resource metadata, RFC 8414
// authorization-server metadata, Dynamic Client Registration (RFC 7591), S256 PKCE,
// rotating refresh tokens for public clients, form-encoded token requests, and a
// 401 with a resource_metadata pointer. Redirect URIs are limited to Claude's hosted
// callback and Claude Code's loopback callback (port-agnostic), so the connector can
// only be used from Claude.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SCOPES = {
  read: "signalforge:read",
  agent: "signalforge:agent",
} as const;
export const ALL_SCOPES = [SCOPES.read, SCOPES.agent] as const;
export const ACCESS_TTL_SECONDS = 3600;
export const REFRESH_TTL_SECONDS = 30 * 86_400;
export const CODE_TTL_SECONDS = 600;

export const CLAUDE_CALLBACKS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];

/** Loopback redirect used by Claude Code (any port, path /callback). */
function loopback(uri: string): { host: string; path: string } | null {
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:" || !(u.hostname === "localhost" || u.hostname === "127.0.0.1")) return null;
    if (u.username || u.password || u.hash) return null;
    return { host: u.hostname, path: u.pathname };
  } catch {
    return null;
  }
}

/** Redirect URIs a client may register. */
export function isAllowedRedirect(uri: string): boolean {
  if (CLAUDE_CALLBACKS.includes(uri)) return true;
  const l = loopback(uri);
  return !!l && l.path === "/callback";
}

/** Does a requested redirect match a registered one? Exact, except loopback ports (RFC 8252 §7.3). */
export function redirectMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const r = loopback(requested);
  if (!r) return false;
  return registered.some((g) => {
    const l = loopback(g);
    return !!l && l.host === r.host && l.path === r.path && new URL(requested).search === "";
  });
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const randomToken = (prefix: string, bytes = 32) => `${prefix}${randomBytes(bytes).toString("base64url")}`;
/** Tokens and codes are stored only as SHA-256 hashes. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function parseScopes(scope: string | null | undefined): string[] | null {
  const requested = (scope ?? "").split(/\s+/).filter(Boolean).filter((s) => s !== "offline_access");
  if (requested.length === 0) return [SCOPES.read, SCOPES.agent];
  return requested.every((s) => (ALL_SCOPES as readonly string[]).includes(s)) ? [...new Set(requested)] : null;
}

export const resourceUrl = (site: string) => `${site}/api/mcp`;

export function protectedResourceMetadata(site: string) {
  return {
    resource: resourceUrl(site),
    authorization_servers: [site],
    scopes_supported: [...ALL_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "SignalForge",
  };
}

export function authorizationServerMetadata(site: string) {
  return {
    issuer: site,
    authorization_endpoint: `${site}/oauth/authorize`,
    token_endpoint: `${site}/api/oauth/token`,
    registration_endpoint: `${site}/api/oauth/register`,
    revocation_endpoint: `${site}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...ALL_SCOPES, "offline_access"],
  };
}

export const wwwAuthenticate = (site: string, error?: "invalid_token" | "insufficient_scope") =>
  `Bearer resource_metadata="${site}/.well-known/oauth-protected-resource"${error ? `, error="${error}"` : ""}`;

export const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(200).optional(),
  redirect_uris: z.array(z.string().max(500)).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().max(200).optional(),
});

export type RegistrationError = { error: "invalid_redirect_uri" | "invalid_client_metadata"; error_description: string };

/** Validates a DCR request: public client, authorization code + refresh token, allowed redirects only. */
export function validateRegistration(body: unknown): { ok: true; name: string; redirectUris: string[] } | { ok: false; err: RegistrationError } {
  const p = registrationSchema.safeParse(body);
  if (!p.success) return { ok: false, err: { error: "invalid_client_metadata", error_description: "Malformed registration request." } };
  const d = p.data;
  if (d.token_endpoint_auth_method && d.token_endpoint_auth_method !== "none") {
    return { ok: false, err: { error: "invalid_client_metadata", error_description: "Only public clients (token_endpoint_auth_method=none) are supported." } };
  }
  if (d.grant_types && d.grant_types.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    return { ok: false, err: { error: "invalid_client_metadata", error_description: "Only authorization_code and refresh_token grants are supported." } };
  }
  if (d.response_types && d.response_types.some((r) => r !== "code")) {
    return { ok: false, err: { error: "invalid_client_metadata", error_description: "Only the code response type is supported." } };
  }
  const bad = d.redirect_uris.find((u) => !isAllowedRedirect(u));
  if (bad) return { ok: false, err: { error: "invalid_redirect_uri", error_description: "SignalForge's MCP server only accepts Claude's callback URLs." } };
  return { ok: true, name: d.client_name ?? "MCP client", redirectUris: [...new Set(d.redirect_uris)] };
}

export const authorizeSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().regex(/^sfc_[A-Za-z0-9_-]{20,64}$/),
  redirect_uri: z.string().max(500),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(1000).optional(),
  scope: z.string().max(300).optional(),
  resource: z.string().max(500).optional(),
});
export type AuthorizeRequest = z.infer<typeof authorizeSchema>;

/** Builds the redirect back to the client (code or error), preserving state. */
export function clientRedirect(redirectUri: string, params: Record<string, string | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}
