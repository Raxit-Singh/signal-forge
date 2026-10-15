// AES-256-GCM envelope for stored credentials (API keys, integration tokens).
// Format: "v<version>:" + base64(iv[12] || tag[16] || ciphertext).
// The workspace id is bound as additional authenticated data, so a ciphertext
// copied into another workspace's row fails to decrypt.
//
// Kept free of Next.js imports so it is unit-testable with `node --test`;
// src/lib/server/credentials.ts wraps it with env loading + "server-only".

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface KeyRing {
  currentVersion: number;
  keys: Map<number, Buffer>;
}

export function parseKeyRing(current: string | undefined, currentVersion: string | undefined, previous: string | undefined): KeyRing {
  const version = Number(currentVersion ?? "1");
  if (!Number.isInteger(version) || version < 1 || version > 32767) {
    throw new Error("CREDENTIALS_KEY_VERSION must be a positive integer");
  }
  const keys = new Map<number, Buffer>();
  keys.set(version, decodeKey(current, "CREDENTIALS_ENCRYPTION_KEY"));
  for (const pair of (previous ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const idx = pair.indexOf(":");
    const v = Number(pair.slice(0, idx));
    if (idx < 1 || !Number.isInteger(v) || v < 1) throw new Error("CREDENTIALS_PREVIOUS_KEYS must be 'version:base64key' pairs");
    if (v === version) throw new Error("A previous key reuses the current key version");
    keys.set(v, decodeKey(pair.slice(idx + 1), `CREDENTIALS_PREVIOUS_KEYS (v${v})`));
  }
  return { currentVersion: version, keys };
}

function decodeKey(b64: string | undefined, name: string): Buffer {
  if (!b64) throw new Error(`${name} is not set`);
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded`);
  return buf;
}

export function encryptSecret(ring: KeyRing, plaintext: string, aad: string): { ciphertext: string; keyVersion: number } {
  const key = ring.keys.get(ring.currentVersion);
  if (!key) throw new Error("Current encryption key missing");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: `v${ring.currentVersion}:${Buffer.concat([iv, tag, enc]).toString("base64")}`,
    keyVersion: ring.currentVersion,
  };
}

export function decryptSecret(ring: KeyRing, ciphertext: string, aad: string): string {
  const m = /^v(\d+):([A-Za-z0-9+/=]+)$/.exec(ciphertext);
  if (!m) throw new Error("Malformed ciphertext");
  const key = ring.keys.get(Number(m[1]));
  if (!key) throw new Error(`No key available for version ${m[1]}`);
  const raw = Buffer.from(m[2] ?? "", "base64");
  if (raw.length < 29) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** True when the row should be re-encrypted with the current key (rotation). */
export function needsRotation(ring: KeyRing, ciphertext: string): boolean {
  const m = /^v(\d+):/.exec(ciphertext);
  return !m || Number(m[1]) !== ring.currentVersion;
}
