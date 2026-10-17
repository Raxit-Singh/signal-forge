// SignalForge Intelligence model prices (pure).
//
// Gemini API paid tier, Standard, USD per million tokens, from
// ai.google.dev/gemini-api/docs/pricing (page dated 2026-10-16). Models are
// chosen by configuration (SIGNALFORGE_AI_MODEL etc.), never assumed in code:
// a model without a known price can't be billed to SignalForge, so its calls
// are refused before they are made.

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
}

export const PRICES_AS_OF = "2026-10-16";

export const PRICES: Record<string, ModelPrice> = {
  "gemini-3.1-flash-lite": { inputPerMTok: 0.25, outputPerMTok: 1.5, cacheReadPerMTok: 0.025 },
  "gemini-3.5-flash-lite": { inputPerMTok: 0.3, outputPerMTok: 2.5, cacheReadPerMTok: 0.03 },
  // Flash prices double on 2027-01-01 per the pricing page; update this table then.
  "gemini-3.6-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75, cacheReadPerMTok: 0.075 },
  "gemini-3.8-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75, cacheReadPerMTok: 0.075 },
  // Embeddings bill input tokens only.
  "gemini-embedding-2": { inputPerMTok: 0.2, outputPerMTok: 0, cacheReadPerMTok: 0 },
  // The test classifier costs nothing.
  "mock-classifier": { inputPerMTok: 0, outputPerMTok: 0, cacheReadPerMTok: 0 },
  "mock-embedding": { inputPerMTok: 0, outputPerMTok: 0, cacheReadPerMTok: 0 },
};

/** Cost in micro-USD (1 token at $X per million tokens = X micro-USD), or null when the price isn't known. */
export function costMicroUsd(model: string, usage: { inputTokens: number; outputTokens: number; cachedTokens: number }): number | null {
  const p = PRICES[model.replace(/^models\//, "")];
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

export const formatUsd = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(microUsd < 10_000 ? 4 : 2)}`;
