"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { setCookieConsentAction } from "@/app/actions/consent";
import { CONSENT_COOKIE, parseConsent, type Consent } from "@/lib/consent";

// The visitor's choice, read from its cookie; "unknown" on the server, so nothing shows until the page is in the browser.
const CHANGED = "hx:consent";
const OPEN = "hx:cookie-settings";
const subscribe = (fn: () => void) => { addEventListener(CHANGED, fn); return () => removeEventListener(CHANGED, fn); };
const readChoice = () => parseConsent(document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`))?.[1]) ?? "none";

/**
 * Asks once whether Heardex may remember you after you close your browser: sign-in and your workspace, product and
 * time zone are kept for their usual time with "Accept all", and only for the browser session with "Essential only"
 * (src/lib/consent.ts). The two choices look the same; neither is pushed. It shows again from "Change my choice" on the
 * cookie policy page.
 */
export function CookieBanner() {
  const choice = useSyncExternalStore(subscribe, readChoice, () => "unknown");
  const [reopened, setReopened] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => {
    const open = () => setReopened(true);
    addEventListener(OPEN, open);
    return () => removeEventListener(OPEN, open);
  }, []);
  if (choice === "unknown" || (choice !== "none" && !reopened)) return null;

  const choose = (c: Consent) => start(async () => {
    await setCookieConsentAction(c);
    setReopened(false);
    dispatchEvent(new Event(CHANGED));
  });
  return (
    <div role="region" aria-label="Cookie choice" className="cookie-banner">
      <p>
        Heardex uses cookies to keep you signed in and to remember your workspace and time zone. Choose whether we
        remember you after you close your browser. No tracking or ads, either way.{" "}
        <Link href="/legal/cookies">Cookie policy</Link>
      </p>
      <div className="cookie-banner-actions">
        <button type="button" disabled={pending} onClick={() => choose("essential")} aria-pressed={choice === "essential"}>Essential only</button>
        <button type="button" disabled={pending} onClick={() => choose("all")} aria-pressed={choice === "all"}>Accept all</button>
      </div>
    </div>
  );
}

/** Opens the cookie banner again, to change the choice. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return <button type="button" className={className} onClick={() => dispatchEvent(new Event(OPEN))}>Change my choice</button>;
}
