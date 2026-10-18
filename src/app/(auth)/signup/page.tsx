import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "../auth-forms";
import { AuthNoticeBanner } from "../auth-notice";
import { ProviderButtons } from "../provider-buttons";
import { safeRedirectPath } from "@/lib/domain/urls";
import { getAuthProviders } from "@/lib/server/auth-providers";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = sp.next ? safeRedirectPath(sp.next, "/onboarding") : "/onboarding";
  const providers = await getAuthProviders();
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-muted-foreground">Track where people talk about your product. Free plan, no card needed.</p>
      </div>
      <AuthNoticeBanner code={sp.error} provider={sp.provider} next={next} />
      <ProviderButtons providers={providers} next={next} />
      <SignUpForm next={next === "/onboarding" ? undefined : next} />
      <p className="text-center text-[13px] text-muted-foreground">
        Already have an account?{" "}
        <Link href={next === "/onboarding" ? "/login" : `/login?next=${encodeURIComponent(next)}`} className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
