import Link from "next/link";
import { AlertCircle, Info } from "lucide-react";
import { authNotice } from "@/lib/auth/flow";
import { ResendVerificationForm } from "./auth-forms";

/** Explains why the visitor was sent back here (?error=… / ?notice=…) and offers the next step. */
export function AuthNoticeBanner({ code, provider, next }: { code?: string; provider?: string; next?: string }) {
  const notice = authNotice(code, provider);
  if (!notice) return null;
  const error = notice.tone === "error";
  return (
    <div className="grid gap-3">
      <div
        role={error ? "alert" : "status"}
        data-testid="auth-notice"
        className={error
          ? "flex items-start gap-2 rounded-md border border-negative/30 bg-negative/8 px-3 py-2 text-[13px] text-negative"
          : "flex items-start gap-2 rounded-md border bg-muted px-3 py-2 text-[13px]"}
      >
        {error ? <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0" aria-hidden />}
        <span>
          {notice.text}
          {notice.offerReset && (
            <> <Link href="/forgot-password" className="font-medium underline underline-offset-4">Reset password</Link></>
          )}
        </span>
      </div>
      {notice.offerResend && (
        <details className="group text-[13px]">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Request a new verification link</summary>
          <div className="mt-2"><ResendVerificationForm next={next} /></div>
        </details>
      )}
    </div>
  );
}
