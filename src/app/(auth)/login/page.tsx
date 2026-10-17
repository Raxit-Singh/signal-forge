import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "../auth-forms";
import { GoogleButton } from "../google-button";
import { safeRedirectPath } from "@/lib/domain/urls";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, { tone: "error" | "info"; text: string }> = {
  oauth_denied: { tone: "error", text: "Google sign-in was cancelled." },
  oauth_failed: { tone: "error", text: "Google sign-in didn't complete. Try again." },
  oauth_unavailable: { tone: "error", text: "Google sign-in isn't available right now. Use email instead." },
  missing_code: { tone: "error", text: "That sign-in link was incomplete. Try again." },
  invalid_link: { tone: "error", text: "That link isn't valid. Request a new one." },
  link_expired: { tone: "error", text: "That link has expired or was already used. Request a new one." },
  account_deleted: { tone: "info", text: "Your account and its data have been deleted." },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const next = sp.next ? safeRedirectPath(sp.next) : undefined;
  const notice = NOTICES[sp.error ?? sp.notice ?? ""];
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground">Welcome back to SignalForge.</p>
      </div>
      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={notice.tone === "error"
            ? "rounded-md border border-negative/30 bg-negative/8 px-3 py-2 text-[13px] text-negative"
            : "rounded-md border bg-muted px-3 py-2 text-[13px]"}
        >
          {notice.text}
        </p>
      )}
      <GoogleButton next={next} />
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
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
