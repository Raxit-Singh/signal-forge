// Whether SignalForge Intelligence can run, and why not (pure).
//
// SignalForge Intelligence is SignalForge's own AI (SYSTEM A): customers don't
// connect a provider. It runs when the operator has configured it:
//   SIGNALFORGE_AI_ENABLED=true, SIGNALFORGE_AI_PROVIDER=gemini,
//   SIGNALFORGE_GEMINI_API_KEY, SIGNALFORGE_AI_MODEL (a model with a known price),
// plus a global monthly limit row (checked in the database at every reservation)
// and a plan with an AI allowance. In development a workspace can opt into the
// test classifier instead.

import { mockAllowed } from "./mock.ts";
import { PRICES } from "./pricing.ts";

/** Marker stored on the workspace's SignalForge connection row to select the test classifier (development only). */
export const TEST_CLASSIFIER = "test-classifier";

export interface IntelEnv {
  NODE_ENV?: string;
  VERCEL_ENV?: string;
  SIGNALFORGE_AI_ENABLED?: string;
  SIGNALFORGE_AI_PROVIDER?: string;
  SIGNALFORGE_GEMINI_API_KEY?: string;
  SIGNALFORGE_AI_MODEL?: string;
  SIGNALFORGE_AI_DEEP_MODEL?: string;
  SIGNALFORGE_EMBEDDING_MODEL?: string;
}

export type Availability =
  | { ok: true; kind: "test" | "gemini"; models: { cheap: string; deep: string; embedding: string | null } }
  | { ok: false; reason: "disabled" | "not_configured" | "unpriced_model"; message: string };

export function intelligenceAvailability(env: IntelEnv, testClassifierSelected: boolean): Availability {
  if (testClassifierSelected && mockAllowed(env)) {
    return { ok: true, kind: "test", models: { cheap: "mock-classifier", deep: "mock-classifier", embedding: "mock-embedding" } };
  }
  if (env.SIGNALFORGE_AI_ENABLED !== "true") {
    return { ok: false, reason: "disabled", message: "SignalForge Intelligence isn't switched on yet. Mentions are collected as usual but not classified, and nothing is charged." };
  }
  if ((env.SIGNALFORGE_AI_PROVIDER ?? "gemini") !== "gemini" || !env.SIGNALFORGE_GEMINI_API_KEY || !env.SIGNALFORGE_AI_MODEL) {
    return { ok: false, reason: "not_configured", message: "SignalForge Intelligence isn't fully configured on this server." };
  }
  const deep = env.SIGNALFORGE_AI_DEEP_MODEL || env.SIGNALFORGE_AI_MODEL;
  const embedding = env.SIGNALFORGE_EMBEDDING_MODEL || null;
  for (const m of [env.SIGNALFORGE_AI_MODEL, deep, ...(embedding ? [embedding] : [])]) {
    if (!PRICES[m]) return { ok: false, reason: "unpriced_model", message: `The configured model "${m}" has no price in SignalForge's price table, so its cost can't be controlled.` };
  }
  return { ok: true, kind: "gemini", models: { cheap: env.SIGNALFORGE_AI_MODEL, deep, embedding } };
}
