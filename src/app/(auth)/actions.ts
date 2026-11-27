"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { safeRedirectPath } from "@/lib/domain/urls";
import { emailRedirectTo, isOAuthProvider, oauthRedirectTo } from "@/lib/auth/flow";
import { getAuthProviders } from "@/lib/server/auth-providers";
import { hasEarlyAccess } from "@/lib/early-access";
import {
  newPasswordSchema, resetRequestSchema, signInSchema, signUpSchema,
} from "@/lib/validation/schemas";
import { failure, invalid, logServerError, type ActionState } from "@/lib/server/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { pendingSignupSecret } from "@/lib/server/agent/state-secret";
import { PENDING_SIGNUP_COOKIE, PENDING_SIGNUP_TTL_SECONDS, signPendingSignup, verifyPendingSignup } from "@/lib/auth/pending-signup";

/**
 * Where sign-in links and provider callbacks return to: the address the visitor
 * is actually using, so the PKCE cookie set here is there when they come back
 * (a NEXT_PUBLIC_SITE_URL left at localhost on a deployment would otherwise
 * strand them). Supabase only honours addresses in its Redirect URLs allow
 * list, so a forged Host header can't redirect anywhere else.
 */
async function site(): Promise<string> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host"))?.split(",")[0]?.trim();
  if (!host || !/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return publicEnv.NEXT_PUBLIC_SITE_URL;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || (local ? "http" : "https");
  return `${proto === "http" && !local ? "https" : proto}://${host}`;
}

/** Error state that also tells the form to offer "Resend verification email". */
const unconfirmed = (): ActionState => ({
  status: "error",
  message: "Confirm your email first. Open the verification link we sent you, or send a new one below.",
  fields: { _resend: "1" },
});

export async function signInAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (error.code === "email_not_confirmed") return unconfirmed();
    if (error.code === "user_banned") return failure("This account can't sign in right now. Contact support.");
    if (error.status === 429) return failure("Too many attempts. Wait a minute and try again.");
    if (error.code !== "invalid_credentials") logServerError("signIn", error);
    // Same message for unknown email and wrong password (no account enumeration).
    return failure("Incorrect email or password. Accounts created with Google or GitHub have no password: use that button, or reset your password to add one.");
  }
  // Onboarding sends finished accounts on to the dashboard.
  redirect(safeRedirectPath(parsed.data.next, "/onboarding"));
}

export async function signUpAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  if (!hasEarlyAccess(parsed.data.email)) {
    return failure("Heardex is in private testing and isn't taking new accounts yet. Sign-ups open soon.");
  }
  const next = safeRedirectPath(String(formData.get("next") ?? ""), "/onboarding");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    // After confirming: onboarding, or where the visitor was headed (e.g. an invitation link).
    options: { emailRedirectTo: emailRedirectTo(await site(), next) },
  });
  if (error) {
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      return failure("We've sent too many emails in the last hour. Wait a while and try again.");
    }
    if (error.code === "weak_password") return failure(error.message);
    if (error.code === "signup_disabled") return failure("New sign-ups are closed right now.");
    if (error.code === "email_address_invalid") return { status: "error", message: "Check the highlighted fields.", fields: { email: "Use a real email address you can receive mail at." } };
    logServerError("signUp", error);
    if (error.code === "email_address_not_authorized") {
      return failure("We couldn't send a verification email to that address. Try another address, or contact support.");
    }
    return failure("We couldn't create your account. Try again in a moment.");
  }
  // Supabase returns the same response for an address that already has an
  // account (no enumeration, no duplicate account). Only a new account (one with an identity) is remembered.
  if (data.user && data.user.identities?.length) {
    (await cookies()).set(PENDING_SIGNUP_COOKIE, signPendingSignup(pendingSignupSecret(), data.user.id), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: PENDING_SIGNUP_TTL_SECONDS,
    });
  }
  const q = new URLSearchParams({ email: parsed.data.email });
  if (next !== "/onboarding") q.set("next", next);
  redirect(`/signup/check-email?${q}`);
}

/**
 * Polled by "Check your email": has the email been confirmed yet, on any device? When it has, this browser (the one
 * that signed up, proven by its httpOnly cookie) is signed in and the page moves on. Before then nothing happens.
 */
export async function checkSignupConfirmedAction(): Promise<{ confirmed: boolean; waiting: boolean }> {
  const supabase = await createClient();
  const jar = await cookies();
  // Opened the link in this browser: already signed in.
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.email_confirmed_at) {
    jar.delete(PENDING_SIGNUP_COOKIE);
    return { confirmed: true, waiting: false };
  }
  const userId = verifyPendingSignup(pendingSignupSecret(), jar.get(PENDING_SIGNUP_COOKIE)?.value);
  if (!userId) return { confirmed: false, waiting: false };
  const admin = createAdminClient();
  const { data: found } = await admin.auth.admin.getUserById(userId);
  const account = found?.user;
  if (!account?.email || !account.email_confirmed_at) return { confirmed: false, waiting: true };
  // Confirmed on another device: sign this browser in with a one-time link that is never emailed.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: account.email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    logServerError("checkSignupConfirmed", linkError ?? new Error("no token"));
    return { confirmed: false, waiting: true };
  }
  const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (error) {
    logServerError("checkSignupConfirmed", error);
    return { confirmed: false, waiting: true };
  }
  jar.delete(PENDING_SIGNUP_COOKIE);
  return { confirmed: true, waiting: false };
}

export async function resendVerificationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const next = safeRedirectPath(String(formData.get("next") ?? ""), "/onboarding");
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: emailRedirectTo(await site(), next) },
  });
  if (error) {
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      return failure("A verification email was sent recently. Wait a few minutes before asking for another.");
    }
    logServerError("resendVerification", error);
  }
  // Same answer whether the address is unknown, unconfirmed or already confirmed.
  return { status: "success", message: "If that address is waiting for confirmation, a new verification link is on its way. Only the newest link works." };
}

export async function signInWithProviderAction(formData: FormData): Promise<void> {
  const provider = formData.get("provider");
  const next = safeRedirectPath(String(formData.get("next") ?? ""), "/onboarding");
  if (!isOAuthProvider(provider)) redirect("/login?error=oauth_unavailable");
  // Never send the browser to a provider Supabase would reject with a raw error page.
  if (!(await getAuthProviders())[provider]) redirect(`/login?error=oauth_unavailable&provider=${provider}`);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: oauthRedirectTo(await site(), provider, next) },
  });
  if (error || !data.url) {
    logServerError(`oauth:${provider}`, error ?? "no url");
    redirect(`/login?error=oauth_unavailable&provider=${provider}`);
  }
  redirect(data.url);
}

export async function requestPasswordResetAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: emailRedirectTo(await site(), "/reset-password"),
  });
  if (error?.status === 429 || error?.code === "over_email_send_rate_limit") {
    return failure("Too many requests. Wait a few minutes and try again.");
  }
  if (error) logServerError("resetPassword", error);
  // Same response whether or not the account exists.
  return { status: "success", message: "If an account exists for that email, a reset link is on its way. Open it in this browser." };
}

export async function updatePasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = newPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return failure("Your reset link has expired. Request a new one.");
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return failure("Choose a password you haven't used here before.");
    if (error.code === "weak_password") return failure(error.message);
    if (error.code === "reauthentication_needed" || error.code === "session_expired") {
      return failure("Your reset link has expired. Request a new one.");
    }
    logServerError("updatePassword", error);
    return failure("Couldn't update your password. Request a new reset link.");
  }
  redirect("/overview?notice=password_updated");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login?notice=signed_out");
}
