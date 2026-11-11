// The visitor's cookie choice (the cookie banner, src/components/cookie-banner.tsx). Pure: used by the proxy, the
// server and the browser alike.
//   all        sign-in and settings cookies are kept for their usual time, so you stay signed in;
//   essential  the same cookies, but only for this browser session: closing the browser forgets you.
// Nothing changes what the site can do; only how long it remembers you.

export const CONSENT_COOKIE = "hx_consent";
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;
export type Consent = "all" | "essential";

export function parseConsent(value: string | null | undefined): Consent | null {
  return value === "all" || value === "essential" ? value : null;
}

type Lifetime = { maxAge?: number; expires?: Date | number | string };

/**
 * Cookie options as the visitor's choice allows. With "all" they are kept as given. Otherwise (essential, or no choice
 * yet) the cookie lasts only for the browser session: its lifetime is dropped. A cookie being deleted (max-age 0, or an
 * expiry in the past) is left alone, so signing out still works.
 */
export function withConsent<T extends Lifetime>(options: T, consent: Consent | null): T;
export function withConsent<T extends Lifetime>(options: T | undefined, consent: Consent | null): T | undefined;
export function withConsent<T extends Lifetime>(options: T | undefined, consent: Consent | null): T | undefined {
  if (!options || consent === "all") return options;
  if (options.maxAge !== undefined && options.maxAge <= 0) return options;
  if (options.expires !== undefined && new Date(options.expires).getTime() <= Date.now()) return options;
  const session = { ...options };
  delete session.maxAge;
  delete session.expires;
  return session;
}
