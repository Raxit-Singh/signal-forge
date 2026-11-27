"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkSignupConfirmedAction } from "../actions";

export const VERIFIED_CHANNEL = "hx:signup-verified";
const EVERY_MS = 4000;

/**
 * On "Check your email": waits for the email to be confirmed, on this device or any other, then goes on to `next`
 * (onboarding) by itself. Checks every few seconds while the tab is visible, at once when it comes back into view,
 * and at once when the link is opened in another tab of this browser (the "Email verified" page says so).
 */
export function WaitForConfirmation({ next }: { next: string }) {
  const router = useRouter();
  const [state, setState] = useState<"waiting" | "done" | "off">("waiting");
  const busy = useRef(false);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const check = async () => {
      if (stopped || busy.current || document.visibilityState !== "visible") return;
      busy.current = true;
      try {
        const r = await checkSignupConfirmedAction();
        if (stopped) return;
        if (r.confirmed) {
          stopped = true;
          setState("done");
          router.replace(next);
          return;
        }
        // Nothing to wait for in this browser (it didn't sign up here, or too long ago): stop checking.
        if (!r.waiting) { stopped = true; setState("off"); }
      } catch {
        // A failed check is retried on the next tick.
      } finally {
        busy.current = false;
      }
    };
    const loop = () => { timer = window.setTimeout(async () => { await check(); if (!stopped) loop(); }, EVERY_MS); };
    loop();
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", visible);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(VERIFIED_CHANNEL);
      channel.onmessage = () => void check();
    } catch {
      // No BroadcastChannel: the timer still notices.
    }
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      channel?.close();
    };
  }, [next, router]);

  if (state === "off") return null;
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2 text-[13px] text-muted-foreground">
      <span className={`size-2 rounded-full ${state === "done" ? "bg-positive" : "animate-pulse bg-primary"}`} aria-hidden />
      {state === "done" ? "Email confirmed. Taking you in…" : "Waiting for you to open the link. This page continues by itself, even if you open it on your phone."}
    </p>
  );
}
