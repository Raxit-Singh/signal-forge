"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { cn } from "@/lib/utils";
import {
  requestPasswordResetAction, resendVerificationAction, signInAction, signUpAction, updatePasswordAction,
} from "./actions";

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useFormAction(signInAction, idle);
  const needsConfirmation = state.status === "error" && state.fields?._resend === "1";
  return (
    <div className="grid gap-4">
      <form action={action} className="grid gap-4" noValidate>
        {next && <input type="hidden" name="next" value={next} />}
        <FormMessage state={state} />
        <Field name="email" label="Email" type="email" autoComplete="email" required autoFocus state={state} />
        <div className="grid gap-1.5">
          <Field name="password" label="Password" type="password" autoComplete="current-password" required state={state} />
          <Link href="/forgot-password" className="justify-self-end text-xs text-muted-foreground hover:text-foreground">
            Forgot password?
          </Link>
        </div>
        <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      </form>
      {needsConfirmation && <ResendVerificationForm email={state.values?.email} next={next} />}
    </div>
  );
}

const RULES = [
  { label: "At least 10 characters", test: (p: string) => p.length >= 10 },
  { label: "A letter", test: (p: string) => /[A-Za-z]/.test(p) },
  { label: "A number", test: (p: string) => /[0-9]/.test(p) },
];

export function SignUpForm({ next }: { next?: string }) {
  const [state, action] = useFormAction(signUpAction, idle);
  const [password, setPassword] = useState("");
  return (
    <form action={action} className="grid gap-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <FormMessage state={state} />
      <Field name="email" label="Work email" type="email" autoComplete="email" required autoFocus state={state} />
      <div className="grid gap-2">
        <Field
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={72}
          state={state}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />
        <ul className="grid gap-1 text-xs" aria-label="Password requirements">
          {RULES.map((r) => {
            const ok = r.test(password);
            return (
              <li key={r.label} className={cn("flex items-center gap-1.5", ok ? "text-positive" : "text-muted-foreground")}>
                {ok ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-3" aria-hidden />}
                {r.label}
                <span className="sr-only">{ok ? " (met)" : " (not met yet)"}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
      <p className="text-xs text-muted-foreground">We&apos;ll email you a link to confirm your address before you can sign in.</p>
    </form>
  );
}

/** Asks Supabase to send a fresh verification link (rate-limited; same answer for every address). */
export function ResendVerificationForm({ email, next, compact = false }: { email?: string; next?: string; compact?: boolean }) {
  const [state, action] = useFormAction(resendVerificationAction, idle);
  if (state.status === "success") return <FormMessage state={state} />;
  return (
    <form action={action} className="grid gap-3 rounded-md border bg-muted/40 p-3" noValidate aria-label="Resend verification email">
      {next && <input type="hidden" name="next" value={next} />}
      <FormMessage state={state} />
      {email && compact ? (
        <input type="hidden" name="email" value={email} />
      ) : (
        <Field name="email" label="Email to confirm" type="email" autoComplete="email" required defaultValue={email} state={state} />
      )}
      <SubmitButton variant="secondary" pendingLabel="Sending…">Resend verification email</SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useFormAction(requestPasswordResetAction, idle);
  if (state.status === "success") return <FormMessage state={state} />;
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="email" label="Email" type="email" autoComplete="email" required autoFocus state={state} />
      <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useFormAction(updatePasswordAction, idle);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="password" label="New password" type="password" autoComplete="new-password" required autoFocus state={state}
        hint="At least 10 characters, with a letter and a number." />
      <Field name="confirm" label="Confirm new password" type="password" autoComplete="new-password" required state={state} />
      <SubmitButton pendingLabel="Saving…">Update password</SubmitButton>
    </form>
  );
}
