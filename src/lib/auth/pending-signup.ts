// The browser that signed up, remembered while its email is unconfirmed (pure). Signing up sets an httpOnly cookie
// holding this signed token; once the email is confirmed (on any device), the "Check your email" page in that browser
// signs in on its own. The token names the account and expires; it signs nobody in until the email is confirmed.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const PENDING_SIGNUP_COOKIE = "hx_pending_signup";
/** Long enough to resend the link a few times; the link itself lasts an hour. */
export const PENDING_SIGNUP_TTL_SECONDS = 2 * 3600;

export function signPendingSignup(secret: Buffer, userId: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ u: userId, exp: Math.floor(now / 1000) + PENDING_SIGNUP_TTL_SECONDS, n: randomBytes(12).toString("base64url") })).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

/** The account id in a valid, unexpired token; null otherwise. */
export function verifyPendingSignup(secret: Buffer, token: string | undefined | null, now = Date.now()): string | null {
  const [body, mac, extra] = (token ?? "").split(".");
  if (!body || !mac || extra !== undefined) return null;
  const a = Buffer.from(mac);
  const b = Buffer.from(createHmac("sha256", secret).update(body).digest("base64url"));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { u?: unknown; exp?: unknown };
    if (typeof p.u !== "string" || !/^[0-9a-f-]{36}$/i.test(p.u) || typeof p.exp !== "number" || p.exp * 1000 < now) return null;
    return p.u;
  } catch {
    return null;
  }
}
