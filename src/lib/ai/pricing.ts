// Model choice and price table (pure).
//
// Anthropic prices are Anthropic's published first-party rates (per million
// tokens, USD) as of 2026-10-06. OpenAI and Gemini are BYOK only: the customer
// picks the model (we can't vouch for a price list we haven't verified), so
// their cost is reported as unknown and their usage is capped in tokens.

import type { AiProviderId, AiTier } from "./types.ts";

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
}

export const ANTHROPIC_MODELS: Record<AiTier, string> = {
  // Bulk classification: the cheapest current model.
  cheap: "claude-haiku-5-5",
  // On-demand analysis that must cite evidence.
  deep: "claude-opus-5-5",
};

export const PRICES: Record<string, ModelPrice> = {
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5, cacheReadPerMTok: 0.01 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 },
  // The test classifier costs nothing.
  "mock-classifier": { inputPerMTok: 0, outputPerMTok: 0, cacheReadPerMTok: 0 },
};

/** Cost in micro-USD (1 token at $X per million tokens = X micro-USD), or null when the price isn't known. */
export function costMicroUsd(model: string, usage: { inputTokens: number; outputTokens: number; cachedTokens: number }): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedTokens);
  return Math.round(uncached * p.inputPerMTok + usage.cachedTokens * p.cacheReadPerMTok + usage.outputTokens * p.outputPerMTok);
}

/**
 * Conservative token estimate for a reservation: ~3 characters per token
 * (real text is usually 3.5–4, so this over-reserves rather than under).
 */
export function estimateInputTokens(...texts: string[]): number {
  return Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 3) + 50;
}

/** Upper bound reserved before a call: estimated input + the full output allowance. */
export function reservation(model: string, inputTokens: number, maxOutputTokens: number) {
  const tokens = inputTokens + maxOutputTokens;
  return { tokens, microUsd: costMicroUsd(model, { inputTokens, outputTokens: maxOutputTokens, cachedTokens: 0 }) };
}

export function defaultModel(provider: AiProviderId, tier: AiTier, configured: string | null): string | null {
  if (provider === "anthropic") return ANTHROPIC_MODELS[tier];
  if (provider === "mock") return "mock-classifier";
  // OpenAI / Gemini: whatever model the customer chose (one model for both tiers).
  return configured;
}

export const formatUsd = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(microUsd < 10_000 ? 4 : 2)}`;
