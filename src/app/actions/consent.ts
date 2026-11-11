"use server";

import { cookies } from "next/headers";
import { CONSENT_COOKIE, CONSENT_MAX_AGE, parseConsent, withConsent } from "@/lib/consent";
import { PRODUCT_COOKIE, WORKSPACE_COOKIE } from "@/lib/server/session";
import { TIME_ZONE_COOKIE } from "@/lib/server/timezone";

const YEAR = 60 * 60 * 24 * 365;
const secure = process.env.NODE_ENV === "production";

/**
 * Saves the visitor's cookie choice, and re-saves the cookies they already have to match it: kept for their usual
 * time with "all", only for this browser session with "essential". The values don't change, only how long they last.
 */
export async function setCookieConsentAction(choice: string): Promise<void> {
  const consent = parseConsent(choice);
  if (!consent) return;
  const store = await cookies();
  store.set(CONSENT_COOKIE, consent, { path: "/", sameSite: "lax", secure, maxAge: CONSENT_MAX_AGE });
  for (const { name, value } of store.getAll()) {
    if (name.startsWith("sb-")) {
      // Supabase's sign-in cookies, with its own defaults (readable by its browser client, 400 days).
      store.set(name, value, withConsent({ path: "/", sameSite: "lax" as const, secure, maxAge: 400 * 24 * 60 * 60 }, consent));
    } else if (name === WORKSPACE_COOKIE || name === PRODUCT_COOKIE) {
      store.set(name, value, withConsent({ path: "/", sameSite: "lax" as const, secure, httpOnly: true, maxAge: YEAR }, consent));
    } else if (name === TIME_ZONE_COOKIE) {
      store.set(name, value, withConsent({ path: "/", sameSite: "lax" as const, maxAge: YEAR }, consent));
    }
  }
}
