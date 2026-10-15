import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "../auth-forms";
import { GoogleButton } from "../google-button";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-muted-foreground">Track where people talk about your product. Free plan, no card needed.</p>
      </div>
      <GoogleButton next="/onboarding" />
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      <SignUpForm />
      <p className="text-center text-[13px] text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
