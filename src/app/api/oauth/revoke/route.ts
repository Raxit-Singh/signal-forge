import { createAdminClient } from "@/lib/supabase/admin";
import { revokeToken } from "@/lib/server/agent/oauth-store";
import { formBody } from "@/lib/server/agent/http";

// RFC 7009 token revocation. Always 200 (unknown tokens are not an error).
export async function POST(req: Request) {
  const b = await formBody(req);
  if (b.token) await revokeToken(createAdminClient(), b.token);
  return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
}
