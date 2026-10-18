import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { ResendVerificationForm } from "../../auth-forms";
import { safeRedirectPath } from "@/lib/domain/urls";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string; next?: string }> }) {
  const { email, next: rawNext } = await searchParams;
  const next = rawNext ? safeRedirectPath(rawNext, "/onboarding") : undefined;
  return (
    <div className="grid gap-5">
      <MailCheck className="size-8 text-primary" aria-hidden />
      <div className="grid gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Confirm your email</h1>
        <p className="text-muted-foreground">
          We sent a verification link{email ? <> to <span className="font-medium text-foreground">{email}</span></> : null}.
          Open it to finish creating your account. The link works for one hour; opening it in this browser signs you in straight away.
        </p>
      </div>
      <div className="grid gap-2 text-[13px]">
        <p className="font-medium">Nothing arrived after a few minutes?</p>
        <p className="text-muted-foreground">Check spam, then send a new link. Only the newest link works.</p>
        <ResendVerificationForm email={email} next={next} compact={!!email} />
      </div>
      <p className="text-[13px] text-muted-foreground">
        Wrong address? <Link href="/signup" className="text-foreground underline-offset-4 hover:underline">Start again</Link>.
        Already have an account? <Link href="/login" className="text-foreground underline-offset-4 hover:underline">Sign in</Link>.
      </p>
    </div>
  );
}
