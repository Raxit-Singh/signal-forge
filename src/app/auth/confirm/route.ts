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
  // A confirmed sign-up shows "Email verified" in the tab the link opened: the sign-up carries on by itself in the tab
  // it started in (src/app/(auth)/signup/check-email), which may be on another device. `here` says this browser is
  // signed in too, so it can also continue here.
  const verified = (here: boolean) => go(`/signup/verified?${new URLSearchParams({ next, ...(here ? { here: "1" } : {}) })}`);
  const fail = (key: AuthNoticeKey) => go(`/${key === "recovery_elsewhere" || (recovery && key === "link_expired") ? "forgot-password" : "login"}?error=${key}`);

  if (searchParams.get("error") || searchParams.get("error_code")) {
    // An already-used link, opened again in a browser that is signed in by now (the sign-up tab signs in by itself
    // once the email is confirmed elsewhere): nothing to do but carry on.
    if (!recovery) {
      const { data: { user } } = await (await createClient()).auth.getUser();
      if (user?.email_confirmed_at) return go(next);
    }
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
    return type === "recovery" ? go("/reset-password") : type === "signup" || type === "email" ? verified(true) : go(next);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Opened in a different browser from the one that signed up: Supabase has already confirmed the email, but only
      // that browser can use the code. It signs in there by itself.
      if (error.code === "pkce_code_verifier_not_found") return recovery ? fail("recovery_elsewhere") : verified(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email_confirmed_at && !recovery) return go(next);
      return fail("link_expired");
    }
    return recovery ? go("/reset-password") : verified(true);
  }

  return fail("invalid_link");
}
