"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { safeRedirectPath } from "@/lib/domain/urls";
import {
  newPasswordSchema, resetRequestSchema, signInSchema, signUpSchema,
} from "@/lib/validation/schemas";
import { failure, invalid, logServerError, type ActionState } from "@/lib/server/action-result";

const site = () => publicEnv.NEXT_PUBLIC_SITE_URL;

export async function signInAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (error.code === "email_not_confirmed") {
      return failure("Confirm your email first — check your inbox for the verification link.");
    }
    if (error.status === 429) return failure("Too many attempts. Wait a minute and try again.");
    // Same message for unknown email and wrong password (no account enumeration).
    return failure("Incorrect email or password.");
  }
  redirect(safeRedirectPath(parsed.data.next, "/overview"));
}

export async function signUpAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    // After confirming: onboarding, or where the visitor was headed (e.g. an invitation link).
    options: { emailRedirectTo: `${site()}/auth/confirm?next=${encodeURIComponent(safeRedirectPath(String(formData.get("next") ?? ""), "/onboarding"))}` },
  });
  if (error) {
    if (error.status === 429) return failure("Too many sign-up attempts. Try again later.");
    if (error.code === "weak_password") return failure(error.message);
    logServerError("signUp", error);
    return failure("We couldn't create your account. Try again in a moment.");
  }
  // Supabase deliberately returns the same response for existing emails.
  redirect(`/signup/check-email?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function signInWithGoogleAction(formData: FormData): Promise<void> {
  const next = safeRedirectPath(String(formData.get("next") ?? ""), "/overview");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${site()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) {
    logServerError("google", error ?? "no url");
    redirect("/login?error=oauth_unavailable");
  }
  redirect(data.url);
}

export async function requestPasswordResetAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${site()}/auth/confirm?next=/reset-password`,
  });
  if (error?.status === 429) return failure("Too many requests. Wait a few minutes and try again.");
  if (error) logServerError("resetPassword", error);
  // Same response whether or not the account exists.
  return { status: "success", message: "If an account exists for that email, a reset link is on its way." };
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
    logServerError("updatePassword", error);
    return failure("Couldn't update your password. Request a new reset link.");
  }
  redirect("/overview?notice=password_updated");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
