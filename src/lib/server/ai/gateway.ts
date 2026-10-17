import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server/env";
import { openCredential } from "@/lib/server/credentials";
import { availability, pickConnection, type Availability, type ConnectionRow } from "@/lib/ai/availability";
import { mockClient } from "@/lib/ai/mock";
import { anthropicClient, geminiClient, openaiClient } from "@/lib/ai/providers";
import { costMicroUsd, estimateInputTokens, reservation } from "@/lib/ai/pricing";
import { AiError, type AiCall, type AiProviderClient, type AiResult } from "@/lib/ai/types";

export interface ResolvedAi {
  client: AiProviderClient;
  /** Value stored in ai_usage_records.provider. */
  provider: ConnectionRow["provider"];
  billedTo: "signalforge" | "byok";
  /** The test classifier (development only): outputs are labelled as such. */
  test: boolean;
  /** Prefix for mention_classifications.classifier. */
  classifier: (model: string) => string;
}

function envRecord(): Record<string, string | undefined> {
  const env = serverEnv();
  return { NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV, AI_SIGNALFORGE_ENABLED: env.AI_SIGNALFORGE_ENABLED, ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY };
}

export async function loadConnection(admin: SupabaseClient, workspaceId: string): Promise<ConnectionRow | null> {
  const { data } = await admin
    .from("ai_provider_connections")
    .select("provider, status, default_model, secret_id, is_default")
    .eq("workspace_id", workspaceId);
  return pickConnection((data ?? []) as ConnectionRow[]);
}

export async function workspaceAvailability(admin: SupabaseClient, workspaceId: string): Promise<Availability> {
  return availability(await loadConnection(admin, workspaceId), envRecord());
}

/** The client a workspace's AI work runs on, or why it can't run. Keys are decrypted only here. */
export async function resolveAi(admin: SupabaseClient, workspaceId: string): Promise<ResolvedAi | Extract<Availability, { ok: false }>> {
  const conn = await loadConnection(admin, workspaceId);
  const a = availability(conn, envRecord());
  if (!a.ok) return a;
  if (a.kind === "test") {
    return { client: mockClient(), provider: "signalforge", billedTo: "byok", test: true, classifier: (m) => `test:${m}` };
  }
  if (a.kind === "signalforge") {
    return { client: anthropicClient(serverEnv().ANTHROPIC_API_KEY!), provider: "signalforge", billedTo: "signalforge", test: false, classifier: (m) => `anthropic:${m}` };
  }
  const key = await decryptKey(admin, workspaceId, conn!.secret_id!);
  if (!key) return { ok: false, reason: "invalid_key", message: "The saved API key couldn't be read. Save it again." };
  const client =
    conn!.provider === "anthropic" ? anthropicClient(key)
    : conn!.provider === "openai" ? openaiClient(key, conn!.default_model!)
    : geminiClient(key, conn!.default_model!);
  return { client, provider: conn!.provider, billedTo: "byok", test: false, classifier: (m) => `${conn!.provider}:${m}` };
}

export async function decryptKey(admin: SupabaseClient, workspaceId: string, secretId: string): Promise<string | null> {
  const { data } = await admin.from("credential_secrets").select("ciphertext").eq("id", secretId).eq("workspace_id", workspaceId).maybeSingle();
  if (!data?.ciphertext) return null;
  try {
    return openCredential(workspaceId, data.ciphertext as string);
  } catch {
    return null;
  }
}

const BUDGET_MESSAGES: Record<string, string> = {
  plan_budget: "This workspace has used its AI allowance for the billing period.",
  global_budget: "SignalForge AI credits have reached this month's spending limit.",
  global_budget_missing: "SignalForge AI credits have no spending limit set yet, so nothing is spent.",
  unknown_price: "This model's price isn't known, so it can't be billed to SignalForge credits.",
  byok_cap: "Your monthly token cap for your own API key has been reached.",
};

/** A rejected key stops all AI work for the workspace until it is replaced. */
async function markKeyInvalid(admin: SupabaseClient, workspaceId: string, provider: string, message: string) {
  if (provider === "signalforge") {
    console.error(`[ai] SignalForge AI key rejected: ${message}`);
    return;
  }
  await admin.from("ai_provider_connections").update({ status: "invalid", last_error: message.slice(0, 300) })
    .eq("workspace_id", workspaceId).eq("provider", provider);
}

/**
 * One budgeted model call: reserve the upper bound, call, settle what was
 * actually used (also when the output is unusable, since it was billed),
 * release the reservation if the provider was never reached.
 */
export async function budgetedCall<T>(
  admin: SupabaseClient, ai: ResolvedAi, ctx: { workspaceId: string; productId: string | null }, call: AiCall<T>, cacheKey: string | null = null,
): Promise<AiResult<T> & { costMicroUsd: number | null }> {
  const model = ai.client.modelFor(call.tier);
  const est = reservation(model, estimateInputTokens(call.system, call.user), call.maxTokens);
  const { data: r, error } = await admin.rpc("svc_ai_reserve", {
    p_workspace_id: ctx.workspaceId, p_product_id: ctx.productId, p_provider: ai.provider, p_model: model,
    p_purpose: call.purpose, p_billed_to: ai.billedTo, p_tokens: est.tokens, p_microusd: est.microUsd,
  });
  if (error) throw new AiError("unavailable", `Couldn't reserve AI budget (${error.code ?? "db"}).`);
  const res = r as { ok: boolean; id?: number; reason?: string };
  if (!res.ok) throw new AiError("budget", BUDGET_MESSAGES[res.reason ?? ""] ?? "AI budget unavailable.");

  try {
    const out = await ai.client.generate(call);
    const cost = costMicroUsd(out.model, out.usage);
    await admin.rpc("svc_ai_settle", {
      p_id: res.id, p_input_tokens: out.usage.inputTokens, p_output_tokens: out.usage.outputTokens, p_cached_tokens: out.usage.cachedTokens,
      p_cost_microusd: cost, p_success: true, p_error: null, p_cache_key: cacheKey,
    });
    return { ...out, costMicroUsd: cost };
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError("unavailable", e instanceof Error ? e.message : "Unknown error");
    if (err.usage) {
      await admin.rpc("svc_ai_settle", {
        p_id: res.id, p_input_tokens: err.usage.inputTokens, p_output_tokens: err.usage.outputTokens, p_cached_tokens: err.usage.cachedTokens,
        p_cost_microusd: costMicroUsd(model, err.usage), p_success: false, p_error: err.kind, p_cache_key: null,
      });
    } else {
      await admin.rpc("svc_ai_release", { p_id: res.id, p_error: err.kind });
    }
    if (err.kind === "auth") await markKeyInvalid(admin, ctx.workspaceId, ai.provider, err.message);
    throw err;
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
    entries.map((e) => ({ cache_key: e.key, workspace_id: workspaceId, purpose, model, output: e.output })),
    { onConflict: "cache_key" },
  );
  if (error) console.error(`[ai] cache write failed (${error.code ?? "db"})`);
}
