import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/domain/urls";
import { noticeForAuthError, type AuthNoticeKey } from "@/lib/auth/flow";

// Email links: signup confirmation, password recovery, magic link, email change.
// Accepts both shapes Supabase can send:
//  - token_hash + type (the recommended templates in ENVIRONMENT_SETUP.md):
//    verified here, so it works in any browser or device;
//  - code (Supabase's default {{ .ConfirmationURL }} template with PKCE):
//    Supabase has already verified the email; the code signs in only the
//    browser that started the sign-up, because the PKCE verifier lives in its cookie.
// Supabase reports a failed verification as ?error=…&error_code=… on the redirect.
const ALLOWED: EmailOtpType[] = ["signup", "email", "recovery", "email_change", "invite", "magiclink"];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeRedirectPath(searchParams.get("next"), "/onboarding");
  const recovery = searchParams.get("type") === "recovery" || next === "/reset-password";
  const go = (path: string) => NextResponse.redirect(`${origin}${path}`);
  const fail = (key: AuthNoticeKey) => go(`/${key === "recovery_elsewhere" || (recovery && key === "link_expired") ? "forgot-password" : "login"}?error=${key}`);

  if (searchParams.get("error") || searchParams.get("error_code")) {
    return fail(noticeForAuthError({
      error: searchParams.get("error"), code: searchParams.get("error_code"), description: searchParams.get("error_description"),
    }, "email"));
  }

  const supabase = await createClient();
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  if (tokenHash) {
    if (!type || !ALLOWED.includes(type)) return fail("invalid_link");
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      // A second click in the browser that is already signed in by the first one: carry on.
      if (type !== "recovery") {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email_confirmed_at) return go(next);
      }
      return fail(error.code === "otp_expired" || error.status === 403 ? "link_expired" : noticeForAuthError({ code: error.code }, "email"));
    }
    return go(type === "recovery" ? "/reset-password" : next);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      if (error.code === "pkce_code_verifier_not_found") return fail(recovery ? "recovery_elsewhere" : "confirmed_elsewhere");
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email_confirmed_at && !recovery) return go(next);
      return fail("link_expired");
    }
    return go(recovery ? "/reset-password" : next);
  }

  return fail("invalid_link");
}
