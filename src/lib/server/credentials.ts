import "server-only";
import { serverEnv } from "@/lib/server/env";
import { decryptSecret, encryptSecret, parseKeyRing, type KeyRing } from "@/lib/server/crypto";

let ring: KeyRing | null = null;

function keyRing(): KeyRing {
  if (!ring) {
    const env = serverEnv();
    ring = parseKeyRing(env.CREDENTIALS_ENCRYPTION_KEY, env.CREDENTIALS_KEY_VERSION, env.CREDENTIALS_PREVIOUS_KEYS);
  }
  return ring;
}

/** Encrypts a credential bound to its workspace. Plaintext never leaves this module's callers. */
export function sealCredential(workspaceId: string, plaintext: string) {
  return encryptSecret(keyRing(), plaintext, `workspace:${workspaceId}`);
}

export function openCredential(workspaceId: string, ciphertext: string) {
  return decryptSecret(keyRing(), ciphertext, `workspace:${workspaceId}`);
}

export function credentialsConfigured(): boolean {
  try {
    keyRing();
    return true;
  } catch {
    return false;
  }
}
