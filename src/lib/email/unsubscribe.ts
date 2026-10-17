// Signed unsubscribe tokens (pure). They don't expire: an unsubscribe link in an
// old email must keep working. A token only ever turns one email type off for
// one person in one workspace.
import { createHmac, timingSafeEqual } from "node:crypto";

export type UnsubscribeKind = "weekly_report";
export interface UnsubscribeTarget { u: string; w: string; k: UnsubscribeKind }

export function unsubscribeToken(secret: Buffer, t: UnsubscribeTarget): string {
  const body = Buffer.from(JSON.stringify({ u: t.u, w: t.w, k: t.k })).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(`unsubscribe:${body}`).digest("base64url")}`;
}

export function verifyUnsubscribe(secret: Buffer, token: string): UnsubscribeTarget | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const a = Buffer.from(mac);
  const b = Buffer.from(createHmac("sha256", secret).update(`unsubscribe:${body}`).digest("base64url"));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UnsubscribeTarget;
    const uuid = /^[0-9a-f-]{36}$/;
    return uuid.test(t.u) && uuid.test(t.w) && t.k === "weekly_report" ? t : null;
  } catch {
    return null;
  }
}
