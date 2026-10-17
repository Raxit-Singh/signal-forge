import { validateRegistration } from "@/lib/agent/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { registerClient } from "@/lib/server/agent/oauth-store";
import { json } from "@/lib/server/agent/http";

// RFC 7591 Dynamic Client Registration (public clients; Claude's callbacks only).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const v = validateRegistration(body);
  if (!v.ok) return json(v.err, 400);
  const clientId = await registerClient(createAdminClient(), v.name, v.redirectUris);
  return json({
    client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: v.name, redirect_uris: v.redirectUris,
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
  }, 201);
}
