import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/domain/urls";
import { isOAuthProvider, noticeForAuthError } from "@/lib/auth/flow";

// OAuth (Google, GitHub, X) PKCE callback. The code verifier lives in an
// httpOnly cookie set by @supabase/ssr when the flow started, which also binds
// the callback to the browser that initiated it (state/CSRF protection is
// handled by Supabase Auth). Supabase links a provider to an existing account
// only when both email addresses are verified; otherwise it is a separate
// account. SignalForge never merges accounts itself.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"), "/onboarding");
  const p = searchParams.get("provider");
  const provider = isOAuthProvider(p) ? `&provider=${p}` : "";
  const fail = (key: string) => NextResponse.redirect(`${origin}/login?error=${key}${provider}`);

  if (searchParams.get("error") || searchParams.get("error_code")) {
    return fail(noticeForAuthError({
      error: searchParams.get("error"), code: searchParams.get("error_code"), description: searchParams.get("error_description"),
    }, "oauth"));
  }
  if (!code) return fail("missing_code");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error(`[oauthCallback] ${error.code ?? error.status}`);
    return fail(noticeForAuthError({ code: error.code, description: error.message }, "oauth"));
  }
  // Onboarding sends accounts that already finished it on to the dashboard.
  return NextResponse.redirect(`${origin}${next}`);
}
