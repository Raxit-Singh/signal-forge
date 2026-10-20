import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  batchPosts, classificationCacheKey, productContextHash, toPosts,
} from "@/lib/ai/pipeline";
import {
  classificationPrompt, classificationSchema, labelsToApply, validateClassification, type ProductContext, type ValidClassification,
} from "@/lib/ai/prompts";
import { AiError } from "@/lib/ai/types";
import { aiRelevanceDecision } from "@/lib/ai/relevance-decision";
import { emitEvent } from "@/lib/server/collection/monitor";
import { budgetedCall, cacheGet, cachePut, resolveAi, type ResolvedAi } from "./gateway";

/** Classification attempts per mention before it is marked failed (labels stay empty, nothing else changes). */
const MAX_ATTEMPTS = 3;
/** Mentions one job classifies (newest first). */
const JOB_LIMIT = 200;
/** Longer than a run can take (a job stops well inside the 60 s function limit); expires if a run dies. */
const LOCK_TTL_SECONDS = 5 * 60;

export interface ClassifySummary {
  status: "done" | "unavailable" | "disabled" | "budget" | "busy";
  message?: string;
  classified: number;
  cached: number;
  failed: number;
  calls: number;
}

export async function productContext(admin: SupabaseClient, productId: string): Promise<(ProductContext & { workspaceId: string }) | null> {
  const { data: p } = await admin.from("products").select("id, workspace_id, name, description, website_url, category").eq("id", productId).maybeSingle();
  if (!p) return null;
  const [{ data: aliases }, { data: competitors }] = await Promise.all([
    admin.from("product_aliases").select("term, kind").eq("product_id", productId).eq("enabled", true).limit(50),
    admin.from("competitors").select("name").eq("product_id", productId).eq("enabled", true).limit(20),
  ]);
  const terms = (aliases ?? []).map((a) => ({ term: a.term as string, kind: a.kind as string }));
  return {
    workspaceId: p.workspace_id as string,
    name: p.name as string,
    description: (p.description as string | null) ?? null,
    website: (p.website_url as string | null) ?? null,
    category: (p.category as string | null) ?? null,
    aliases: [...new Set(terms.filter((t) => t.kind !== "custom").map((t) => t.term))],
    keywords: [...new Set(terms.map((t) => t.term))],
    competitors: (competitors ?? []).map((c) => c.name as string),
  };
}

interface Row {
  id: string;
  source: string;
  title: string | null;
  content: string | null;
  content_hash: string | null;
  ai_attempts: number;
}

/**
 * SignalForge Intelligence classification of a product's unclassified mentions:
 * whether it is about the product, product-targeted sentiment, category,
 * feedback signals, severity, affected area and confidence. Mentions the keyword
 * rules left for review ("pending") are decided by a confident answer
 * (aiRelevanceDecision); rule decisions and anything a person decided are never
 * changed. Manual corrections are never overwritten.
 */
export async function classifyProduct(admin: SupabaseClient, productId: string, limit = JOB_LIMIT): Promise<ClassifySummary> {
  // One classification run per product at a time: overlapping scheduler ticks (or "Classify
  // now" during a scheduled run) used to send the same mentions to the AI twice and pay twice.
  const lock = `ai:classify:${productId}`;
  const holder = crypto.randomUUID();
  const { data: got } = await admin.rpc("svc_try_acquire_lock", { p_name: lock, p_holder: holder, p_ttl_seconds: LOCK_TTL_SECONDS });
  if (!got) return { status: "busy", classified: 0, cached: 0, failed: 0, calls: 0 };
  try {
    return await classifyProductLocked(admin, productId, limit);
  } finally {
    await admin.rpc("svc_release_lock", { p_name: lock, p_holder: holder });
  }
}

async function classifyProductLocked(admin: SupabaseClient, productId: string, limit: number): Promise<ClassifySummary> {
  const summary: ClassifySummary = { status: "done", classified: 0, cached: 0, failed: 0, calls: 0 };
  const product = await productContext(admin, productId);
  if (!product) return { ...summary, status: "unavailable", message: "Product not found." };

  const { data: settings } = await admin.from("ai_settings").select("auto_classify").eq("workspace_id", product.workspaceId).maybeSingle();
  if (settings && settings.auto_classify === false) return { ...summary, status: "disabled" };

  const ai = await resolveAi(admin, product.workspaceId);
  if ("ok" in ai) return { ...summary, status: "unavailable", message: ai.message };

  const { data: rows, error } = await admin
    .from("mentions")
    .select("id, source, title, content, content_hash, ai_attempts")
    .eq("product_id", productId)
    .eq("processing_status", "filtered")
    .eq("dedup_kind", "original")
    .in("relevance_status", ["relevant", "pending", "user_relevant"])
    .lt("ai_attempts", MAX_ATTEMPTS)
    .order("discovered_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`load mentions: ${error.message}`);
  const mentions = ((rows ?? []) as Row[]).filter((m) => `${m.title ?? ""}${m.content ?? ""}`.trim());
  if (!mentions.length) return summary;

  const ctxHash = productContextHash(product);
  const model = ai.client.modelFor("cheap");
  const keyOf = new Map(mentions.map((m) => [m.id, classificationCacheKey({
    workspaceId: product.workspaceId, productContextHash: ctxHash, model, title: m.title, content: m.content, contentHash: m.content_hash,
  })]));

  // Cached answers (same text, same context, same model and prompt) cost nothing.
  const cache = await cacheGet(admin, [...keyOf.values()]);
  const fromCache: ValidClassification[] = [];
  const todo: Row[] = [];
  for (const m of mentions) {
    const hit = cache.get(keyOf.get(m.id)!) as Omit<ValidClassification, "id"> | undefined;
    if (hit) fromCache.push({ ...hit, id: m.id });
    else todo.push(m);
  }
  const manual = await manualDimensions(admin, mentions.map((m) => m.id));
  await applyResults(admin, ai, product.workspaceId, fromCache, manual, model);
  summary.cached = fromCache.length;
  summary.classified += fromCache.length;

  for (const batch of batchPosts(todo)) {
    const { posts, idMap } = toPosts(batch);
    const { system, user } = classificationPrompt(product, posts);
    let results: ValidClassification[];
    let missing: string[];
    try {
      const out = await budgetedCall(admin, ai, { workspaceId: product.workspaceId, productId }, {
        purpose: "classify", tier: "cheap", system, user, schema: classificationSchema, schemaName: "classification",
        maxTokens: 200 + posts.length * 160, mockInput: { posts },
      });
      summary.calls++;
      const v = validateClassification(out.output, posts.map((p) => p.id));
      results = v.results.map((r) => ({ ...r, id: idMap.get(r.id)! }));
      missing = v.missing.map((id) => idMap.get(id)!);
    } catch (e) {
      if (e instanceof AiError && e.kind === "budget") {
        summary.status = "budget";
        summary.message = e.message;
        break;
      }
      if (e instanceof AiError && (e.kind === "invalid_output" || e.kind === "refused" || e.kind === "bad_request")) {
        // This batch can't be classified as sent: count an attempt for each mention and move on.
        await bumpAttempts(admin, batch);
        summary.failed += batch.length;
        continue;
      }
      throw e; // rate limits / outages: the job is retried or deferred
    }
    await applyResults(admin, ai, product.workspaceId, results, manual, model);
    await cachePut(admin, product.workspaceId, "classify", model, results.map((r) => ({ key: keyOf.get(r.id)!, output: { ...r, id: undefined } })));
    summary.classified += results.length;
    const missed = batch.filter((m) => missing.includes(m.id));
    await bumpAttempts(admin, missed);
    summary.failed += missed.length;
  }

  if (summary.classified > 0) await emitEvent(admin, product.workspaceId, productId, "ai", { classified: summary.classified });
  return summary;
}

async function manualDimensions(admin: SupabaseClient, ids: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("mention_classifications").select("mention_id, dimension")
      .in("mention_id", ids.slice(i, i + 200)).eq("classifier", "manual").in("dimension", ["sentiment", "category"]);
    for (const r of data ?? []) {
      const s = out.get(r.mention_id as string) ?? new Set<string>();
      s.add(r.dimension as string);
      out.set(r.mention_id as string, s);
    }
  }
  return out;
}

async function applyResults(admin: SupabaseClient, ai: ResolvedAi, workspaceId: string, results: ValidClassification[], manual: Map<string, Set<string>>, model: string) {
  if (!results.length) return;
  const classifier = ai.classifier(model);
  const now = new Date().toISOString();
  const history: Array<Record<string, unknown>> = [];
  await Promise.all(results.map(async (r) => {
    const l = labelsToApply(r);
    const keep = manual.get(r.id) ?? new Set<string>();
    const patch: Record<string, unknown> = {
      ai_about_product: r.aboutProduct, ai_reason: r.reason || null, ai_model: classifier, ai_classified_at: now, processing_status: "classified",
      ai_signals: r.signals, ai_severity: r.severity, ai_area: r.area || null, ai_confidence: r.confidence,
    };
    if (!keep.has("sentiment")) Object.assign(patch, { sentiment: l.sentiment, sentiment_confidence: l.sentimentConfidence });
    if (!keep.has("category")) Object.assign(patch, { feedback_category: l.category, category_confidence: l.categoryConfidence });
    const { error } = await admin.from("mentions").update(patch).eq("id", r.id).eq("workspace_id", workspaceId);
    if (error) console.error(`[ai] mention update failed (${error.code ?? "db"})`);
    // Only a mention still awaiting review changes; the billing trigger counts it once relevant.
    const decision = aiRelevanceDecision("pending", r.aboutProduct, r.confidence);
    if (!error && decision) {
      const { error: decideError } = await admin.from("mentions").update({ relevance_status: decision })
        .eq("id", r.id).eq("workspace_id", workspaceId).eq("relevance_status", "pending");
      if (decideError) console.error(`[ai] relevance decision not stored (${decideError.code ?? "db"})`);
    }
    const base = { workspace_id: workspaceId, mention_id: r.id, classifier, rationale: r.reason || null };
    history.push(
      { ...base, dimension: "relevance", label: r.aboutProduct, confidence: null },
      { ...base, dimension: "sentiment", label: r.sentiment, confidence: r.sentimentConfidence },
      { ...base, dimension: "category", label: r.intelCategory, confidence: r.categoryConfidence },
    );
  }));
  const { error } = await admin.from("mention_classifications").insert(history);
  if (error) console.error(`[ai] classification history not written (${error.code ?? "db"})`);
}

async function bumpAttempts(admin: SupabaseClient, rows: Row[]) {
  await Promise.all(rows.map((m) => admin.from("mentions").update({
    ai_attempts: m.ai_attempts + 1,
    ...(m.ai_attempts + 1 >= MAX_ATTEMPTS ? { processing_status: "failed" } : {}),
  }).eq("id", m.id)));
}

/** Products with mentions waiting for classification, in workspaces whose AI can run. */
export async function productsAwaitingClassification(admin: SupabaseClient, limit = 50): Promise<Array<{ productId: string; workspaceId: string }>> {
  const { data } = await admin
    .from("mentions")
    .select("product_id, workspace_id")
    .eq("processing_status", "filtered")
    .eq("dedup_kind", "original")
    .in("relevance_status", ["relevant", "pending", "user_relevant"])
    .lt("ai_attempts", MAX_ATTEMPTS)
    .order("discovered_at", { ascending: false })
    .limit(2000);
  const seen = new Map<string, string>();
  for (const r of data ?? []) if (!seen.has(r.product_id as string)) seen.set(r.product_id as string, r.workspace_id as string);
  return [...seen.entries()].slice(0, limit).map(([productId, workspaceId]) => ({ productId, workspaceId }));
}
