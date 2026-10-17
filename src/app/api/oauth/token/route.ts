import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCode, getClient, refresh } from "@/lib/server/agent/oauth-store";
import { formBody, json, oauthError } from "@/lib/server/agent/http";

// Token endpoint: authorization_code (PKCE) and refresh_token (rotating). Public clients.
export async function POST(req: Request) {
  const b = await formBody(req);
  const admin = createAdminClient();
  const clientId = b.client_id ?? "";
  if (!clientId || !(await getClient(admin, clientId))) return oauthError("invalid_client", "Unknown client.", 401);
  if (b.grant_type === "authorization_code") {
    if (!b.code || !b.redirect_uri || !b.code_verifier) return oauthError("invalid_request", "code, redirect_uri and code_verifier are required.");
    const r = await exchangeCode(admin, { code: b.code, clientId, redirectUri: b.redirect_uri, verifier: b.code_verifier });
    return "error" in r ? oauthError(r.error, r.error_description) : json(r);
  }
  if (b.grant_type === "refresh_token") {
    if (!b.refresh_token) return oauthError("invalid_request", "refresh_token is required.");
    const r = await refresh(admin, { refreshToken: b.refresh_token, clientId });
    return "error" in r ? oauthError(r.error, r.error_description) : json(r);
  }
  return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
}
