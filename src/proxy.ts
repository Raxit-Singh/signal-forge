import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 "proxy" (formerly middleware). Refreshes the Supabase session
// cookie on every request and keeps signed-out users out of app routes.
// Authorization is NOT decided here: every page and action re-checks the user
// and workspace membership on the server, and RLS enforces it again in Postgres.

const PUBLIC_PREFIXES = ["/login", "/signup", "/forgot-password", "/auth", "/legal"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // Do not run code between createServerClient and getUser(): it must refresh the session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path === "/" || PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (user && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/overview";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Skip static assets and the scheduler endpoint (authenticated by its own secret).
    // Also skipped: the MCP server, OAuth endpoints and discovery documents (bearer-token or
    // public; no browser session), and the development-only routine stand-in.
    "/((?!_next/static|_next/image|favicon.ico|api/jobs|api/mcp|api/oauth|api/dev/mock-routine|api/dev/mock-github|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
