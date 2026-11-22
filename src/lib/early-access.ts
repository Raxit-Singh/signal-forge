/**
 * Private testing. While EARLY_ACCESS_EMAILS lists addresses (comma-separated,
 * any case), only those people can create an account or use the app; everyone
 * else sees /early-access. The landing, pricing, docs and legal pages stay
 * public. Leave it unset or empty to open Heardex to everyone.
 */
export function earlyAccessList(): Set<string> | null {
  const raw = process.env.EARLY_ACCESS_EMAILS ?? "";
  const emails = raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return emails.length ? new Set(emails) : null;
}

/** True when Heardex is open to everyone or this address is on the list. */
export function hasEarlyAccess(email: string | null | undefined): boolean {
  const list = earlyAccessList();
  if (!list) return true;
  return Boolean(email) && list.has(email!.trim().toLowerCase());
}

/** The main call to action for signed-out visitors: early access while sign-ups are closed, sign-up once they open. */
export function signedOutStart(): { href: string; label: string } {
  return earlyAccessList() ? { href: "/early-access", label: "Get early access" } : { href: "/signup", label: "Start free" };
}
