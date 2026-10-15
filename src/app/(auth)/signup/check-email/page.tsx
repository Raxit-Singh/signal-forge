import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <div className="grid gap-4">
      <MailCheck className="size-8 text-primary" aria-hidden />
      <h1 className="text-xl font-semibold tracking-tight">Confirm your email</h1>
      <p className="text-muted-foreground">
        We sent a verification link{email ? <> to <span className="font-medium text-foreground">{email}</span></> : null}.
        Open it on any device to finish creating your account.
      </p>
      <p className="text-[13px] text-muted-foreground">
        Nothing after a few minutes? Check spam, or{" "}
        <Link href="/signup" className="text-foreground underline-offset-4 hover:underline">try again</Link>. If the
        address already has an account, <Link href="/login" className="text-foreground underline-offset-4 hover:underline">sign in</Link> instead.
      </p>
    </div>
  );
}
