// Which paths exist and who may see them, for the proxy (pure: no Next, no env reads beyond what's passed in).
//
// A path that is neither public nor part of the signed-in app does not exist: it gets a real 404 (HTML for browsers,
// Markdown for agents that ask for it), never a sign-in redirect, so nobody probing the site is told every path is there.

/** Pages anyone can open. Each also covers the paths under it. */
export const PUBLIC_PREFIXES = ["/login", "/signup", "/early-access", "/forgot-password", "/auth", "/legal", "/alternatives", "/docs", "/blog", "/product"] as const;

/** Machine-readable files anyone can fetch (exact paths). */
export const PUBLIC_FILES = ["/openapi.json", "/index.md", "/llms.txt", "/robots.txt", "/sitemap.xml", "/opengraph-image"] as const;

/** The signed-in app. Each also covers the paths under it. A signed-out visitor is sent to sign in. */
export const APP_PREFIXES = [
  "/overview", "/feedback", "/insights", "/mentions", "/monitoring", "/buzz", "/competitors", "/reports", "/settings", "/admin",
  "/onboarding", "/invite", "/oauth", "/reset-password", "/api/github",
] as const;

const under = (path: string, prefixes: readonly string[]) => prefixes.some((p) => path === p || path.startsWith(`${p}/`));

export function isPublicPath(path: string, opts: { prototypes?: boolean } = {}): boolean {
  return path === "/" || (PUBLIC_FILES as readonly string[]).includes(path) || under(path, PUBLIC_PREFIXES) || (Boolean(opts.prototypes) && under(path, ["/prototypes"]));
}

export const isAppPath = (path: string) => under(path, APP_PREFIXES);

/** API paths answer in JSON, whatever the request asks for. */
export const isApiPath = (path: string) => path === "/api" || path.startsWith("/api/");

/**
 * Whether the request prefers Markdown to HTML (RFC 9110 content negotiation): text/markdown is listed with a quality
 * above zero and at least as high as text/html's (and any wildcard's, when text/html isn't listed).
 */
export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false;
  const q = new Map<string, number>();
  for (const part of accept.toLowerCase().split(",")) {
    const [type, ...params] = part.trim().split(";").map((s) => s.trim());
    if (!type) continue;
    const qp = params.find((p) => p.startsWith("q="));
    const v = qp ? Number(qp.slice(2)) : 1;
    q.set(type, Number.isFinite(v) ? v : 0);
  }
  const md = q.get("text/markdown") ?? 0;
  if (md <= 0) return false;
  const html = q.get("text/html") ?? q.get("text/*") ?? q.get("*/*") ?? 0;
  return md >= html;
}

/** The Markdown body of a 404, for agents. */
export function notFoundMarkdown(path: string, base: string): string {
  return [
    "# 404: page not found",
    "",
    `There is no page at \`${path.replace(/`/g, "")}\` on Heardex.`,
    "",
    "Where to look instead:",
    "",
    `- [llms.txt](${base}/llms.txt): what Heardex is, and a list of every public page`,
    `- [Sitemap](${base}/sitemap.xml): every public page`,
    `- [Docs](${base}/docs): how Heardex works`,
    `- [OpenAPI spec](${base}/openapi.json): the public HTTP API (OAuth and the MCP server)`,
    "",
  ].join("\n");
}

/** The JSON body of an API 404. */
export function apiNotFound(path: string, base: string) {
  return {
    error: {
      code: "not_found",
      message: `There is no API endpoint at ${path}.`,
      hint: `The public API is described at ${base}/openapi.json. Agents usually want the MCP server at ${base}/api/mcp.`,
      docs: `${base}/docs/api`,
    },
  };
}
