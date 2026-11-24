import { apiNotFound } from "@/lib/routes";
import { json, site } from "@/lib/server/agent/http";

// Any /api path that isn't an endpoint: a JSON 404 (agents can't read the HTML not-found page). Real endpoints are more
// specific routes and always win over this catch-all.
export const dynamic = "force-dynamic";

const notFound = (req: Request) => json(apiNotFound(new URL(req.url).pathname, site()), 404);

export const GET = notFound;
export const HEAD = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
