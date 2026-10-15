import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-muted-foreground">We&apos;ll email you a link to choose a new one.</p>
      </div>
      <ForgotPasswordForm />
      <Link href="/login" className="text-center text-[13px] text-muted-foreground hover:text-foreground">
        Back to sign in
      </Link>
    </div>
  );
}
