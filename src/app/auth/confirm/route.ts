import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/domain/urls";

// Email links (signup confirmation, password recovery, email change).
// Requires the Supabase email templates to link here with token_hash — see
// ENVIRONMENT_SETUP.md. Works across devices, unlike the PKCE code flow.
const ALLOWED: EmailOtpType[] = ["signup", "email", "recovery", "email_change", "invite"];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeRedirectPath(searchParams.get("next"), "/overview");

  if (!tokenHash || !type || !ALLOWED.includes(type)) {
    return NextResponse.redirect(`${origin}/login?error=invalid_link`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=link_expired`);
  }
  const target = type === "recovery" ? "/reset-password" : next;
  return NextResponse.redirect(`${origin}${target}`);
}
