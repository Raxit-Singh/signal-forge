import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/domain/urls";

// OAuth (Google) PKCE callback. The code verifier lives in an httpOnly cookie
// set by @supabase/ssr when the flow started, which also binds the callback to
// the browser that initiated it (state/CSRF protection is handled by Supabase Auth).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"), "/overview");

  if (searchParams.get("error")) {
    return NextResponse.redirect(`${origin}/login?error=oauth_denied`);
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
