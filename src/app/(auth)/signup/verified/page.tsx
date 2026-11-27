import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { safeRedirectPath } from "@/lib/domain/urls";
import { AnnounceVerified } from "./announce";

export const metadata: Metadata = { title: "Email verified" };

/**
 * Where an email verification link lands. The sign-up carries on by itself in the tab it started in, on this device
 * or another, so this tab can be closed. `here` means this browser is signed in too and can continue here instead.
 */
export default async function VerifiedPage({ searchParams }: { searchParams: Promise<{ next?: string; here?: string }> }) {
  const { next: rawNext, here } = await searchParams;
  const next = safeRedirectPath(rawNext, "/onboarding");
  const signedIn = here === "1";
  return (
    <div className="grid gap-5">
      <AnnounceVerified />
      <CircleCheck className="size-8 text-positive" aria-hidden />
      <div className="grid gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Email verified</h1>
        <p className="text-muted-foreground">
          Your account is confirmed. The tab where you signed up continues by itself, on this device or any other, so you
          can close this tab.
        </p>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {signedIn ? (
          <>Prefer to carry on here? <Link href={next} className="text-foreground underline-offset-4 hover:underline">Continue in this tab</Link>.</>
        ) : (
          <>Want to use Heardex on this device too? <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-foreground underline-offset-4 hover:underline">Sign in here</Link>.</>
        )}
      </p>
    </div>
  );
}
