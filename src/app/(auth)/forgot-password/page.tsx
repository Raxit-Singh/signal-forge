import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "../auth-forms";
import { AuthNoticeBanner } from "../auth-notice";

export const metadata: Metadata = { title: "Reset password" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-muted-foreground">We&apos;ll email you a link to choose a new one. Open it in this browser.</p>
      </div>
      <AuthNoticeBanner code={sp.error === "link_expired" ? "reset_expired" : sp.error} />
      <ForgotPasswordForm />
      <Link href="/login" className="text-center text-[13px] text-muted-foreground hover:text-foreground">
        Back to sign in
      </Link>
    </div>
  );
}
