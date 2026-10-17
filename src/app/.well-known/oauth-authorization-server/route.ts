import { authorizationServerMetadata } from "@/lib/agent/oauth";
import { json, site } from "@/lib/server/agent/http";

// RFC 8414 authorization server metadata.
export function GET() {
  return json(authorizationServerMetadata(site()), 200, { "access-control-allow-origin": "*" });
}
