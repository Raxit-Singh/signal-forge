import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server/env";
import { intelligenceAvailability, TEST_CLASSIFIER, type Availability } from "@/lib/ai/availability";
import { mockClient } from "@/lib/ai/mock";
import { geminiClient } from "@/lib/ai/providers";
import { costMicroUsd, estimateInputTokens, reservation } from "@/lib/ai/pricing";
import { AiError, type AiCall, type AiProviderClient, type AiResult, type EmbedResult } from "@/lib/ai/types";

// SignalForge Intelligence gateway (SYSTEM A). Every model call goes through
// here: reserve the upper bound against the plan's AI allowance and the
// operator's global monthly limit, call, settle actual usage. Customer AI keys
// and the customer's Claude connection are never used for this.

export interface ResolvedAi {
  client: AiProviderClient;
  /** ai_usage_records.provider */
  provider: "gemini" | "signalforge";
  billedTo: "signalforge" | "test";
  /** The development-only test classifier: outputs are labelled as such. */
  test: boolean;
  /** Prefix for mention_classifications.classifier. */
  classifier: (model: string) => string;
}

function intelEnv() {
  const e = serverEnv();
  return {
    NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV,
    SIGNALFORGE_AI_ENABLED: e.SIGNALFORGE_AI_ENABLED, SIGNALFORGE_AI_PROVIDER: e.SIGNALFORGE_AI_PROVIDER,
    SIGNALFORGE_GEMINI_API_KEY: e.SIGNALFORGE_GEMINI_API_KEY, SIGNALFORGE_AI_MODEL: e.SIGNALFORGE_AI_MODEL,
    SIGNALFORGE_AI_DEEP_MODEL: e.SIGNALFORGE_AI_DEEP_MODEL, SIGNALFORGE_EMBEDDING_MODEL: e.SIGNALFORGE_EMBEDDING_MODEL,
  };
}

async function testClassifierSelected(admin: SupabaseClient, workspaceId: string): Promise<boolean> {
  const { data } = await admin.from("ai_provider_connections").select("default_model")
    .eq("workspace_id", workspaceId).eq("provider", "signalforge").maybeSingle();
  return data?.default_model === TEST_CLASSIFIER;
}

export async function workspaceAvailability(admin: SupabaseClient, workspaceId: string): Promise<Availability> {
  return intelligenceAvailability(intelEnv(), await testClassifierSelected(admin, workspaceId));
}

/** The client SignalForge Intelligence runs on for a workspace, or why it can't run. */
export async function resolveAi(admin: SupabaseClient, workspaceId: string): Promise<ResolvedAi | Extract<Availability, { ok: false }>> {
  const a = await workspaceAvailability(admin, workspaceId);
  if (!a.ok) return a;
  if (a.kind === "test") return { client: mockClient(), provider: "signalforge", billedTo: "test", test: true, classifier: (m) => `test:${m}` };
  const client = geminiClient(serverEnv().SIGNALFORGE_GEMINI_API_KEY!, { cheap: a.models.cheap, deep: a.models.deep, embedding: a.models.embedding });
  return { client, provider: "gemini", billedTo: "signalforge", test: false, classifier: (m) => `gemini:${m}` };
}

const BUDGET_MESSAGES: Record<string, string> = {
  plan_budget: "This workspace has used its plan's AI allowance for the billing period (or its plan has none).",
  global_budget: "SignalForge Intelligence has reached this month's spending limit.",
  global_budget_missing: "SignalForge Intelligence has no monthly spending limit set yet, so nothing is spent.",
  unknown_price: "This model's price isn't known, so it can't be used.",
};

type Ctx = { workspaceId: string; productId: string | null };

async function reserve(admin: SupabaseClient, ai: ResolvedAi, ctx: Ctx, model: string, purpose: string, tokens: number, microUsd: number | null) {
  const { data: r, error } = await admin.rpc("svc_ai_reserve", {
    p_workspace_id: ctx.workspaceId, p_product_id: ctx.productId, p_provider: ai.provider, p_model: model,
    p_purpose: purpose, p_billed_to: ai.billedTo, p_tokens: tokens, p_microusd: microUsd,
  });
  if (error) throw new AiError("unavailable", `Couldn't reserve AI budget (${error.code ?? "db"}).`);
  const res = r as { ok: boolean; id?: number; reason?: string };
  if (!res.ok) throw new AiError("budget", BUDGET_MESSAGES[res.reason ?? ""] ?? "AI budget unavailable.");
  return res.id!;
}

async function settle(admin: SupabaseClient, id: number, model: string, usage: { inputTokens: number; outputTokens: number; cachedTokens: number }, success: boolean, error: string | null, cacheKey: string | null) {
  await admin.rpc("svc_ai_settle_v2", {
    p_id: id, p_input_tokens: usage.inputTokens, p_output_tokens: usage.outputTokens, p_cached_tokens: usage.cachedTokens,
    p_cost_microusd: costMicroUsd(model, usage), p_success: success, p_error: error, p_cache_key: cacheKey,
    p_requests: 1, p_provider_cost_microusd: null, // Gemini responses don't report a cost
  });
}

async function onFailure(admin: SupabaseClient, id: number, model: string, e: unknown): Promise<never> {
  const err = e instanceof AiError ? e : new AiError("unavailable", e instanceof Error ? e.message : "Unknown error");
  if (err.usage) await settle(admin, id, model, err.usage, false, err.kind, null);
  else await admin.rpc("svc_ai_release", { p_id: id, p_error: err.kind });
  if (err.kind === "auth") console.error(`[ai] SignalForge's Gemini key was rejected: ${err.message}`);
  if (err.kind === "budget") console.error(`[ai] Gemini refused the call for billing: ${err.message}`);
  throw err;
}

/** One budgeted model call (reserve → call → settle; release if the provider was never reached). */
export async function budgetedCall<T>(admin: SupabaseClient, ai: ResolvedAi, ctx: Ctx, call: AiCall<T>, cacheKey: string | null = null): Promise<AiResult<T> & { costMicroUsd: number | null }> {
  const model = ai.client.modelFor(call.tier);
  const est = reservation(model, estimateInputTokens(call.system, call.user), call.maxTokens);
  const id = await reserve(admin, ai, ctx, model, call.purpose, est.tokens, est.microUsd);
  try {
    const out = await ai.client.generate(call);
    await settle(admin, id, out.model, out.usage, true, null, cacheKey);
    return { ...out, costMicroUsd: costMicroUsd(out.model, out.usage) };
  } catch (e) {
    return onFailure(admin, id, model, e);
  }
}

/** One budgeted embedding request. */
export async function budgetedEmbed(admin: SupabaseClient, ai: ResolvedAi, ctx: Ctx, texts: string[]): Promise<EmbedResult> {
  const model = ai.client.embeddingModel();
  if (!model) throw new AiError("not_configured", "No embedding model is configured.");
  const est = reservation(model, estimateInputTokens(...texts), 0);
  const id = await reserve(admin, ai, ctx, model, "embed", est.tokens, est.microUsd);
  try {
    const out = await ai.client.embed(texts);
    await settle(admin, id, out.model, out.usage, true, null, null);
    return out;
  } catch (e) {
    return onFailure(admin, id, model, e);
  }
}

export async function cacheGet(admin: SupabaseClient, keys: string[]): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await admin.from("ai_cache").select("cache_key, output").in("cache_key", keys.slice(i, i + 200)).gt("expires_at", new Date().toISOString());
    for (const row of data ?? []) out.set(row.cache_key as string, row.output);
  }
  return out;
}

export async function cachePut(admin: SupabaseClient, workspaceId: string, purpose: string, model: string, entries: Array<{ key: string; output: unknown }>) {
  if (!entries.length) return;
  const { error } = await admin.from("ai_cache").upsert(
    // One row per key: identical posts in a batch share a key, and an upsert can't touch a row twice.
    [...new Map(entries.map((e) => [e.key, e])).values()].map((e) => ({ cache_key: e.key, workspace_id: workspaceId, purpose, model, output: e.output })),
    { onConflict: "cache_key" },
  );
  if (error) console.error(`[ai] cache write failed (${error.code ?? "db"})`);
}

/** Decrypts a stored workspace credential (used by the developer agent for the routine token). */
export { decryptKey } from "./secrets";
