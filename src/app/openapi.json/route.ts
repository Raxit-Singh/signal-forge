// /openapi.json: the OpenAPI 3.1 description of the public HTTP API (src/lib/openapi.ts).
import { openApiSpec } from "@/lib/openapi";
import { site } from "@/lib/server/agent/http";

export function GET() {
  return Response.json(openApiSpec(site()), { headers: { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
}
