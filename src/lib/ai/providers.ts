// SignalForge Intelligence model provider: Gemini through the official Google
// Gen AI SDK (@google/genai). The API key is SignalForge's own, passed in by
// server code (never read from the environment here) so the adapter can be
// tested with a fake fetch. This module must only be imported from server code.
//
// Every answer is requested as JSON against a JSON Schema (responseJsonSchema)
// and validated again with the same Zod schema before anything is stored.

import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { AiError, type AiCall, type AiProviderClient, type AiResult, type AiTier, type AiUsage, type EmbedResult } from "./types.ts";

type FetchLike = typeof fetch;

export interface GeminiModels {
  /** Bulk classification and merge checks (required). */
  cheap: string;
  /** On-demand analysis (defaults to the cheap model). */
  deep?: string | null;
  /** Embeddings for semantic grouping (optional: without it, word-based grouping is used). */
  embedding?: string | null;
  embeddingDimensions?: number;
}

const TIMEOUT_MS: Record<AiTier, number> = { cheap: 60_000, deep: 180_000 };
/**
 * Embedding size. Gemini Embedding 2 supports 128–3072 and normalises truncated sizes.
 * 256 keeps a product's feedback vectors small enough to load and compare in one
 * pass (thousands of posts); it is enough to group paraphrases, not for search.
 */
export const EMBEDDING_DIMENSIONS = 256;

function mapError(e: unknown, usage: AiUsage | null = null): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) return new AiError("auth", `Gemini rejected SignalForge's API key (${e.status}).`);
    if (e.status === 429) return new AiError("rate_limited", "Gemini is rate limiting requests.", 60, usage);
    if (e.status === 400 || e.status === 404) return new AiError("bad_request", e.message.slice(0, 300), null, usage);
    return new AiError("unavailable", `Gemini error ${e.status}.`, null, usage);
  }
  return new AiError("unavailable", e instanceof Error ? e.message.slice(0, 300) : "Couldn't reach Gemini.", null, usage);
}

export function geminiClient(apiKey: string, models: GeminiModels, opts: { fetch?: FetchLike; baseUrl?: string } = {}): AiProviderClient {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}), retryOptions: { attempts: 1 } },
  });
  const model = (tier: AiTier) => (tier === "deep" ? models.deep || models.cheap : models.cheap);

  return {
    provider: "gemini",
    modelFor: model,
    embeddingModel: () => models.embedding ?? null,
    async generate<T>(call: AiCall<T>): Promise<AiResult<T>> {
      const m = model(call.tier);
      let res;
      try {
        res = await ai.models.generateContent({
          model: m,
          contents: [{ role: "user", parts: [{ text: call.user }] }],
          config: {
            systemInstruction: call.system,
            responseMimeType: "application/json",
            responseJsonSchema: z.toJSONSchema(call.schema as z.ZodType),
            maxOutputTokens: call.maxTokens,
            temperature: 0,
            httpOptions: { timeout: TIMEOUT_MS[call.tier] },
          },
        });
      } catch (e) {
        throw mapError(e);
      }
      const u = res.usageMetadata;
      const usage: AiUsage = {
        inputTokens: u?.promptTokenCount ?? 0,
        // Thinking tokens are billed as output.
        outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
        cachedTokens: u?.cachedContentTokenCount ?? 0,
      };
      const cand = res.candidates?.[0];
      if (res.promptFeedback?.blockReason || cand?.finishReason === "SAFETY") throw new AiError("refused", "Gemini declined to analyse this content.", null, usage);
      if (cand?.finishReason === "MAX_TOKENS") throw new AiError("invalid_output", "The answer was cut off.", null, usage);
      const text = res.text;
      if (!text) throw new AiError("invalid_output", "Gemini returned no answer.", null, usage);
      let raw: unknown;
      try {
        raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
      } catch {
        throw new AiError("invalid_output", "Gemini's answer wasn't valid JSON.", null, usage);
      }
      const parsed = call.schema.safeParse(raw);
      if (!parsed.success) throw new AiError("invalid_output", "Gemini's answer didn't match the required format.", null, usage);
      return { output: parsed.data, usage, model: res.modelVersion?.replace(/^models\//, "") || m };
    },
    async embed(texts: string[]): Promise<EmbedResult> {
      if (!models.embedding) throw new AiError("not_configured", "No embedding model is configured.");
      let res;
      try {
        res = await ai.models.embedContent({
          model: models.embedding,
          contents: texts,
          config: { outputDimensionality: models.embeddingDimensions ?? EMBEDDING_DIMENSIONS, httpOptions: { timeout: 60_000 } },
        });
      } catch (e) {
        throw mapError(e);
      }
      const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
      if (vectors.length !== texts.length || vectors.some((v) => v.length === 0)) {
        throw new AiError("invalid_output", "Gemini returned the wrong number of embeddings.");
      }
      // The embeddings response carries no token count: estimate (≈4 characters per token) and say so.
      const chars = res.metadata?.billableCharacterCount ?? texts.reduce((n, t) => n + t.length, 0);
      return { vectors, model: models.embedding, estimated: true, usage: { inputTokens: Math.ceil(chars / 4), outputTokens: 0, cachedTokens: 0 } };
    },
  };
}
