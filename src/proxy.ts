import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { CONSENT_COOKIE, parseConsent, withConsent } from "@/lib/consent";
import { hasEarlyAccess } from "@/lib/early-access";
import { apiNotFound, isApiPath, isAppPath, isPublicPath, notFoundMarkdown, prefersMarkdown } from "@/lib/routes";

// Next.js 16 "proxy" (formerly middleware). Refreshes the Supabase session
// cookie on every request and keeps signed-out users out of app routes.
// Authorization is NOT decided here: every page and action re-checks the user
// and workspace membership on the server, and RLS enforces it again in Postgres.

// Design samples: sample data only, and the page returns 404 in production.
const PROTOTYPES = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy with a fresh nonce per request: only Next's own scripts
 * (which carry the nonce) run. Inline style attributes are allowed (charts use
 * them); forms may only lead to Heardex and the sign-in / payment
 * pages it redirects to.
 */
function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseWs = supabase.replace(/^http/, "ws");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase} ${supabaseWs}`,
    // Sentry's error replay compresses recordings in a worker it starts from a blob.
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${supabase} https://accounts.google.com https://github.com https://x.com https://twitter.com https://api.x.com https://api.twitter.com https://*.dodopayments.com`,
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = isPublicPath(path, { prototypes: PROTOTYPES });
  const isApp = isAppPath(path);
  const markdown = !isApiPath(path) && prefersMarkdown(request.headers.get("accept"));

  // Paths that don't exist get a real 404, not a sign-in redirect. Unknown API paths reach the API's JSON 404
  // (src/app/api/[...path]); agents asking for Markdown get a Markdown 404 here; browsers get the not-found page.
  if (!isPublic && !isApp) {
    if (markdown) {
      return new NextResponse(notFoundMarkdown(path, request.nextUrl.origin), {
        status: 404,
        headers: { "content-type": "text/markdown; charset=utf-8", vary: "Accept", "cache-control": "no-store" },
      });
    }
    if (path === "/api") return NextResponse.json(apiNotFound(path, request.nextUrl.origin), { status: 404, headers: { "cache-control": "no-store" } });
  }

  // The home page in Markdown, for agents (the same text as /llms.txt).
  if (path === "/" && markdown) {
    const url = request.nextUrl.clone();
    url.pathname = "/index.md";
    return NextResponse.rewrite(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  // Next reads the nonce from the request's CSP header and applies it to its scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  let response = next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          requestHeaders.set("cookie", request.cookies.toString());
          response = next();
          // Kept past this browser session only if the visitor accepted all cookies (the cookie banner).
          const consent = parseConsent(request.cookies.get(CONSENT_COOKIE)?.value);
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, withConsent(options, consent));
        },
      },
    },
  );

  // Do not run code between createServerClient and getUser(): it must refresh the session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isApp) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  // Private testing: signed-in people not on EARLY_ACCESS_EMAILS can't reach the
  // app, onboarding or invitations (pages and the actions posted to them).
  if (user && isApp && !hasEarlyAccess(user.email)) {
    const url = request.nextUrl.clone();
    url.pathname = "/early-access";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/overview";
    url.search = "";
    return NextResponse.redirect(url);
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Skip static assets and the scheduler endpoint (authenticated by its own secret).
    // Also skipped: the MCP server, OAuth endpoints and discovery documents (bearer-token or
    // public; no browser session), the error-report tunnel, the uptime check, and the development-only routine stand-in.
    "/((?!_next/static|_next/image|favicon.ico|api/jobs|api/mcp|api/agent/queue|api/oauth|api/dev/mock-routine|api/dev/mock-github|api/dodo/webhook|api/email/unsubscribe|api/sentry-tunnel|api/health|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
