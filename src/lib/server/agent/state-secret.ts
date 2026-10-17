import "server-only";
import { hkdfSync } from "node:crypto";
import { serverEnv } from "@/lib/server/env";

/** Key for signing redirect state, derived from the credentials key (never used for encryption). */
export function stateSecret(): Buffer {
  const base = serverEnv().CREDENTIALS_ENCRYPTION_KEY;
  if (!base) throw new Error("CREDENTIALS_ENCRYPTION_KEY is required for signed redirect state.");
  return Buffer.from(hkdfSync("sha256", Buffer.from(base, "base64"), Buffer.alloc(0), "signalforge:redirect-state:v1", 32));
}
