"use client";

import Link from "next/link";
import { Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import {
  requestPasswordResetAction, signInAction, signUpAction, updatePasswordAction,
} from "./actions";

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useFormAction(signInAction, idle);
  return (
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
  );
}

export function SignUpForm() {
  const [state, action] = useFormAction(signUpAction, idle);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="email" label="Work email" type="email" autoComplete="email" required autoFocus state={state} />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        state={state}
        hint="At least 10 characters, with a letter and a number."
      />
      <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
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
