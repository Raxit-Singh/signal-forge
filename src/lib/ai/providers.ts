// Model provider adapters. Keys are passed in by server code (never read from
// the environment here) so the adapters can be tested with a fake fetch; this
// module must only be imported from server code.
//
// Anthropic uses the official SDK with structured outputs. OpenAI and Gemini
// (BYOK only) are called over HTTPS with JSON output; every provider's output
// is validated again with the same Zod schema before anything is stored.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { ANTHROPIC_MODELS } from "./pricing.ts";
import { AiError, type AiCall, type AiProviderClient, type AiResult, type AiTier, type AiUsage } from "./types.ts";

type FetchLike = typeof fetch;

const TIMEOUT_MS: Record<AiTier, number> = { cheap: 60_000, deep: 300_000 };

function retryAfter(h: Headers | undefined | null): number | null {
  const v = h?.get("retry-after");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.ceil(n)) : null;
}

function errorFromStatus(status: number, message: string, headers?: Headers | null): AiError {
  if (status === 401 || status === 403) return new AiError("auth", `The provider rejected the API key (${status}).`);
  if (status === 429) return new AiError("rate_limited", "The provider is rate limiting requests.", retryAfter(headers) ?? 60);
  if (status === 400 || status === 404 || status === 422) return new AiError("bad_request", message.slice(0, 300));
  return new AiError("unavailable", `Provider error ${status}.`, retryAfter(headers));
}

function parseOutput<T>(call: AiCall<T>, raw: unknown, usage: AiUsage): T {
  const r = call.schema.safeParse(raw);
  if (!r.success) throw new AiError("invalid_output", "The model's answer didn't match the required format.", null, usage);
  return r.data;
}

// ---------------------------------------------------------------------------
// Anthropic (official SDK)
// ---------------------------------------------------------------------------

export function anthropicClient(apiKey: string, opts: { fetch?: FetchLike; maxRetries?: number } = {}): AiProviderClient {
  const client = new Anthropic({ apiKey, maxRetries: opts.maxRetries ?? 1, ...(opts.fetch ? { fetch: opts.fetch } : {}) });

  function mapError(e: unknown): AiError {
    if (e instanceof AiError) return e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return errorFromStatus(e.status, e.message);
    if (e instanceof Anthropic.RateLimitError) return errorFromStatus(429, e.message, e.headers);
    if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError) return errorFromStatus(400, e.message);
    if (e instanceof Anthropic.APIConnectionError) return new AiError("unavailable", "Couldn't reach the provider.");
    if (e instanceof Anthropic.APIError) return errorFromStatus(e.status ?? 500, e.message, e.headers);
    return new AiError("unavailable", e instanceof Error ? e.message.slice(0, 300) : "Unknown provider error.");
  }

  return {
    provider: "anthropic",
    modelFor: (tier) => ANTHROPIC_MODELS[tier],
    async generate<T>(call: AiCall<T>): Promise<AiResult<T>> {
      const model = ANTHROPIC_MODELS[call.tier];
      let res;
      try {
        res = await client.beta.messages.parse(
          {
            model,
            max_tokens: call.maxTokens,
            system: call.system,
            messages: [{ role: "user", content: call.user }],
            output_config: {
              format: betaZodOutputFormat(call.schema as z.ZodType),
              // Classification is a simple labelling task: lowest effort, no thinking.
              // Evidence-backed analysis keeps adaptive thinking (it can't be disabled on Opus 5.5).
              effort: call.tier === "cheap" ? "low" : "medium",
            },
            ...(call.tier === "cheap"
              ? { thinking: { type: "disabled" as const } }
              // Server-side fallback when the model declines for policy reasons.
              : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
          },
          { timeout: TIMEOUT_MS[call.tier] },
        );
      } catch (e) {
        throw mapError(e);
      }
      const usage: AiUsage = {
        inputTokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0),
        outputTokens: res.usage.output_tokens,
        cachedTokens: res.usage.cache_read_input_tokens ?? 0,
      };
      if (res.stop_reason === "refusal") throw new AiError("refused", "The model declined to analyse this content.", null, usage);
      if (res.stop_reason === "max_tokens") throw new AiError("invalid_output", "The answer was cut off.", null, usage);
      return { output: parseOutput(call, res.parsed_output, usage), usage, model: res.model };
    },
    async validate() {
      try {
        const models: string[] = [];
        for await (const m of client.models.list({ limit: 100 })) models.push(m.id);
        return { ok: true as const, models };
      } catch (e) {
        const err = mapError(e);
        return { ok: false as const, kind: err.kind, message: err.message };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI (BYOK, HTTPS)
// ---------------------------------------------------------------------------

async function httpJson(f: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new AiError("unavailable", "Couldn't reach the provider.");
  }
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      message = j.error?.message ?? text;
    } catch { /* keep text */ }
    throw errorFromStatus(res.status, message, res.headers);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("unavailable", "The provider returned an unreadable response.");
  }
}

function jsonFromText(text: string | undefined | null, usage: AiUsage): unknown {
  if (!text) throw new AiError("invalid_output", "The model returned no answer.", null, usage);
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new AiError("invalid_output", "The model's answer wasn't valid JSON.", null, usage);
  }
}

const schemaHint = (schema: z.ZodType) => `Answer with a single JSON object matching this JSON Schema, and nothing else:\n${JSON.stringify(z.toJSONSchema(schema))}`;

export function openaiClient(apiKey: string, model: string, opts: { fetch?: FetchLike; baseUrl?: string } = {}): AiProviderClient {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? "https://api.openai.com/v1";
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  return {
    provider: "openai",
    modelFor: () => model,
    async generate<T>(call: AiCall<T>): Promise<AiResult<T>> {
      const body = {
        model,
        max_completion_tokens: call.maxTokens,
        messages: [
          { role: "system", content: `${call.system}\n\n${schemaHint(call.schema as z.ZodType)}` },
          { role: "user", content: call.user },
        ],
        response_format: { type: "json_schema", json_schema: { name: call.schemaName, schema: z.toJSONSchema(call.schema as z.ZodType), strict: false } },
      };
      const j = (await httpJson(f, `${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) }, TIMEOUT_MS[call.tier])) as {
        model?: string;
        choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
      };
      const usage: AiUsage = {
        inputTokens: j.usage?.prompt_tokens ?? 0,
        outputTokens: j.usage?.completion_tokens ?? 0,
        cachedTokens: j.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      };
      const choice = j.choices?.[0];
      if (choice?.message?.refusal) throw new AiError("refused", "The model declined to analyse this content.", null, usage);
      if (choice?.finish_reason === "length") throw new AiError("invalid_output", "The answer was cut off.", null, usage);
      return { output: parseOutput(call, jsonFromText(choice?.message?.content, usage), usage), usage, model: j.model ?? model };
    },
    async validate() {
      try {
        const j = (await httpJson(f, `${base}/models`, { headers }, 20_000)) as { data?: Array<{ id: string }> };
        return { ok: true as const, models: (j.data ?? []).map((m) => m.id) };
      } catch (e) {
        const err = e instanceof AiError ? e : new AiError("unavailable", "Validation failed.");
        return { ok: false as const, kind: err.kind, message: err.message };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Gemini (BYOK, HTTPS)
// ---------------------------------------------------------------------------

export function geminiClient(apiKey: string, model: string, opts: { fetch?: FetchLike; baseUrl?: string } = {}): AiProviderClient {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  // The key goes in a header, never in the URL (URLs end up in logs).
  const headers = { "x-goog-api-key": apiKey, "content-type": "application/json" };
  const id = model.replace(/^models\//, "");
  return {
    provider: "gemini",
    modelFor: () => id,
    async generate<T>(call: AiCall<T>): Promise<AiResult<T>> {
      const body = {
        systemInstruction: { parts: [{ text: `${call.system}\n\n${schemaHint(call.schema as z.ZodType)}` }] },
        contents: [{ role: "user", parts: [{ text: call.user }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: call.maxTokens },
      };
      const j = (await httpJson(f, `${base}/models/${encodeURIComponent(id)}:generateContent`, { method: "POST", headers, body: JSON.stringify(body) }, TIMEOUT_MS[call.tier])) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
        promptFeedback?: { blockReason?: string };
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
        modelVersion?: string;
      };
      const usage: AiUsage = {
        inputTokens: j.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0),
        cachedTokens: j.usageMetadata?.cachedContentTokenCount ?? 0,
      };
      const cand = j.candidates?.[0];
      if (j.promptFeedback?.blockReason || cand?.finishReason === "SAFETY") throw new AiError("refused", "The model declined to analyse this content.", null, usage);
      if (cand?.finishReason === "MAX_TOKENS") throw new AiError("invalid_output", "The answer was cut off.", null, usage);
      const text = cand?.content?.parts?.map((p) => p.text ?? "").join("");
      return { output: parseOutput(call, jsonFromText(text, usage), usage), usage, model: id };
    },
    async validate() {
      try {
        const j = (await httpJson(f, `${base}/models?pageSize=1000`, { headers }, 20_000)) as { models?: Array<{ name: string }> };
        return { ok: true as const, models: (j.models ?? []).map((m) => m.name.replace(/^models\//, "")) };
      } catch (e) {
        const err = e instanceof AiError ? e : new AiError("unavailable", "Validation failed.");
        return { ok: false as const, kind: err.kind, message: err.message };
      }
    },
  };
}
