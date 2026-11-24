"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { setCookieConsentAction } from "@/app/actions/consent";
import { CONSENT_COOKIE, parseConsent, type Consent } from "@/lib/consent";

// The visitor's choice, read from its cookie; "unknown" on the server, so nothing shows until the page is in the browser.
const CHANGED = "hx:consent";
const OPEN = "hx:cookie-settings";
const INTRO = "hx:intro"; // the landing's opening starts or ends (landing/intro-lock.tsx)
const subscribeIntro = (fn: () => void) => { addEventListener(INTRO, fn); return () => removeEventListener(INTRO, fn); };
const readIntro = () => document.documentElement.dataset.intro === "playing";
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
  // On the landing, the banner waits until the opening has played, so it doesn't cover it (then eases in, globals.css).
  const intro = useSyncExternalStore(subscribeIntro, readIntro, () => false);
  useEffect(() => {
    const open = () => setReopened(true);
    addEventListener(OPEN, open);
    return () => removeEventListener(OPEN, open);
  }, []);
  if (choice === "unknown" || intro || (choice !== "none" && !reopened)) return null;

  const choose = (c: Consent) => start(async () => {
    await setCookieConsentAction(c);
    setReopened(false);
    dispatchEvent(new Event(CHANGED));
  });
  return (
    <div role="region" aria-label="Cookie choice" className="cookie-banner">
      <p>
        Heardex uses cookies to keep you signed in and to remember your workspace and time zone. Choose whether we
        remember you after you close your browser, and whether, when something breaks, we may keep a replay of it with
        all text hidden so we can fix it. No ads or tracking across sites, either way.{" "}
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
