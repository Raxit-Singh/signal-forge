import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { wwwAuthenticate } from "@/lib/agent/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAccessToken } from "@/lib/server/agent/oauth-store";
import { buildMcpServer } from "@/lib/server/agent/mcp";
import { site } from "@/lib/server/agent/http";

// SignalForge remote MCP server (Streamable HTTP, stateless: a fresh server per
// request, scoped to the workspace of the bearer token). Unauthenticated requests
// get 401 with a resource_metadata pointer, which starts Claude's OAuth flow.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
  const admin = createAdminClient();
  const who = token ? await validateAccessToken(admin, token) : null;
  if (!who) {
    return new Response(JSON.stringify({ error: "invalid_token", error_description: "Sign in to SignalForge to use this connector." }), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": wwwAuthenticate(site(), token ? "invalid_token" : undefined) },
    });
  }
  const server = buildMcpServer(admin, who);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req, { authInfo: { token: token!, clientId: who.clientId, scopes: who.scopes, expiresAt: who.expiresAt } });
  } finally {
    // Stateless: nothing to keep between requests.
    void server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
