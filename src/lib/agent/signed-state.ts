// Signed, expiring state values for redirect flows (GitHub App install), pure.
// HMAC-SHA256 over the JSON payload; bound to the user who started the flow.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface StatePayload {
  w: string; // workspace id
  u: string; // user id
  p?: string; // product id
  exp: number; // unix seconds
  n: string; // nonce
}

export function signState(secret: Buffer, p: Omit<StatePayload, "exp" | "n">, ttlSeconds = 900, now = Date.now()): string {
  const payload: StatePayload = { ...p, exp: Math.floor(now / 1000) + ttlSeconds, n: randomBytes(12).toString("base64url") };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyState(secret: Buffer, state: string, userId: string, now = Date.now()): StatePayload | null {
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let p: StatePayload;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  } catch {
    return null;
  }
  if (typeof p.exp !== "number" || p.exp * 1000 < now) return null;
  if (p.u !== userId) return null;
  return p;
}
