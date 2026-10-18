import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "../auth-forms";
import { AuthNoticeBanner } from "../auth-notice";
import { ProviderButtons } from "../provider-buttons";
import { safeRedirectPath } from "@/lib/domain/urls";
import { getAuthProviders } from "@/lib/server/auth-providers";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = sp.next ? safeRedirectPath(sp.next) : undefined;
  const providers = await getAuthProviders();
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Sign in to SignalForge</h1>
        <p className="text-muted-foreground">Welcome back.</p>
      </div>
      <AuthNoticeBanner code={sp.error ?? sp.notice} provider={sp.provider} next={next} />
      <ProviderButtons providers={providers} next={next} />
      <SignInForm next={next} />
      <p className="text-center text-[13px] text-muted-foreground">
        New here?{" "}
        <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="font-medium text-foreground hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
