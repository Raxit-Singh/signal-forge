import { protectedResourceMetadata } from "@/lib/agent/oauth";
import { json, site } from "@/lib/server/agent/http";

// RFC 9728 protected resource metadata for the SignalForge MCP server. Served at
// /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp.
export function GET() {
  return json(protectedResourceMetadata(site()), 200, { "access-control-allow-origin": "*" });
}
