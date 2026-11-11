import "server-only";
import { cookies } from "next/headers";
import { CONSENT_COOKIE, parseConsent, withConsent } from "@/lib/consent";

/** `options` for a cookie that remembers the visitor, shortened to the browser session unless they accepted all cookies. */
export async function rememberOptions<T extends { maxAge?: number }>(options: T): Promise<T> {
  return withConsent(options, parseConsent((await cookies()).get(CONSENT_COOKIE)?.value));
}
