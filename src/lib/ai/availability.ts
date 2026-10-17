// Whether a workspace's AI provider can run, and why not (pure).

import { mockAllowed } from "./mock.ts";

export interface ConnectionRow {
  provider: "signalforge" | "anthropic" | "openai" | "gemini";
  status: "unverified" | "valid" | "invalid" | "revoked";
  default_model: string | null;
  secret_id: string | null;
  is_default: boolean;
}

/** Marker stored as default_model on the SignalForge connection to select the test classifier (development only). */
export const TEST_CLASSIFIER = "test-classifier";

export type Availability =
  | { ok: true; kind: "test" | "signalforge" | "byok"; provider: ConnectionRow["provider"] }
  | { ok: false; reason: "no_provider" | "credits_not_enabled" | "not_verified" | "invalid_key" | "model_missing"; message: string };

export function pickConnection(rows: ConnectionRow[]): ConnectionRow | null {
  return rows.find((r) => r.is_default) ?? rows[0] ?? null;
}

export function availability(conn: ConnectionRow | null, env: Record<string, string | undefined>): Availability {
  if (!conn) return { ok: false, reason: "no_provider", message: "No AI provider is set up for this workspace." };
  if (conn.provider === "signalforge") {
    if (conn.default_model === TEST_CLASSIFIER && mockAllowed(env)) return { ok: true, kind: "test", provider: "signalforge" };
    if (env.AI_SIGNALFORGE_ENABLED === "true" && env.ANTHROPIC_API_KEY) return { ok: true, kind: "signalforge", provider: "signalforge" };
    return { ok: false, reason: "credits_not_enabled", message: "SignalForge AI credits aren't switched on yet. Nothing is classified and nothing is charged." };
  }
  if (conn.status === "invalid" || conn.status === "revoked" || !conn.secret_id) {
    return { ok: false, reason: "invalid_key", message: "The saved API key was rejected by the provider. Replace it to resume AI analysis." };
  }
  if (conn.status !== "valid") return { ok: false, reason: "not_verified", message: "Verify the API key before it is used." };
  if ((conn.provider === "openai" || conn.provider === "gemini") && !conn.default_model) {
    return { ok: false, reason: "model_missing", message: "Choose which model to use with this key." };
  }
  return { ok: true, kind: "byok", provider: conn.provider };
}
