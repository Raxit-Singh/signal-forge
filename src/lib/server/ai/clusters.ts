import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLUSTER_CATEGORIES, clusterFeedback, reconcileClusters, tokenize, type ClusterInput, type ComputedCluster, type ExistingCluster } from "@/lib/ai/cluster";
import { embeddingText, finishSemantic, groupSamples, planSemantic, type SemanticItem } from "@/lib/ai/semantic";
import { prioritize, timeFacts } from "@/lib/ai/priority";
import { mergeCheckPrompt, mergeCheckSchema, PROMPT_VERSION } from "@/lib/ai/prompts";
import { sha256 } from "@/lib/ai/pipeline";
import { AiError, type FeedbackCategory, type Sentiment, type Severity } from "@/lib/ai/types";
import { budgetedCall, budgetedEmbed, cacheGet, cachePut, resolveAi, type ResolvedAi } from "./gateway";
import { productContext } from "./classify";

/** Feedback older than this no longer forms new issues (existing ones keep their history). */
const WINDOW_DAYS = 90;
const MAX_MENTIONS = 2000;
const EMBED_BATCH = 50;

type Grouping = "semantic_v1" | "tfidf_v1";

function row(c: ComputedCluster, workspaceId: string, productId: string, grouping: Grouping, p: ReturnType<typeof prioritize>) {
  return {
    workspace_id: workspaceId, product_id: productId, category: c.category, title: c.title.slice(0, 200),
    report_count: c.reportCount, unique_reporters: c.uniqueReporters, platforms: c.platforms, sentiment: c.sentiment,
    suggested_priority: p.level, priority_score: p.score, priority_evidence: p.evidence, area: c.area,
    confidence: c.confidence, first_detected_at: c.firstDetectedAt, last_detected_at: c.lastDetectedAt,
    top_terms: c.topTerms, algorithm: grouping, computed_at: new Date().toISOString(),
  };
}

async function replaceMembers(admin: SupabaseClient, clusterId: string, workspaceId: string, c: ComputedCluster) {
  await admin.from("feedback_cluster_members").delete().eq("cluster_id", clusterId);
  const { error } = await admin.from("feedback_cluster_members").insert(
    c.memberIds.map((id) => ({ cluster_id: clusterId, mention_id: id, workspace_id: workspaceId, similarity: Math.min(1, Math.max(0, c.similarity[id] ?? 0)) })),
  );
  if (error) console.error(`[ai] cluster members not written (${error.code ?? "db"})`);
}

type Row = {
  id: string; source: string; title: string | null; content: string | null; author_external_id: string | null; published_at: string;
  sentiment: Sentiment | null; feedback_category: FeedbackCategory; category_confidence: number | null;
  ai_area: string | null; ai_severity: Severity | null; embedding: number[] | null; embedding_model: string | null;
};

/** Embeds feedback mentions that have no (or a different model's) embedding. Returns false if embeddings aren't available. */
async function ensureEmbeddings(admin: SupabaseClient, ai: ResolvedAi, workspaceId: string, productId: string, rows: Row[]): Promise<boolean> {
  const model = ai.client.embeddingModel();
  if (!model) return false;
  const missing = rows.filter((r) => !r.embedding || r.embedding_model !== model);
  for (let i = 0; i < missing.length; i += EMBED_BATCH) {
    const batch = missing.slice(i, i + EMBED_BATCH);
    let out;
    try {
      out = await budgetedEmbed(admin, ai, { workspaceId, productId }, batch.map((m) => embeddingText(m)));
    } catch (e) {
      if (e instanceof AiError && !e.retryable) return false; // budget / config: fall back to word-based grouping
      throw e;
    }
    const now = new Date().toISOString();
    await Promise.all(batch.map((m, k) => {
      m.embedding = out.vectors[k]!;
      m.embedding_model = out.model;
      return admin.from("mentions").update({ embedding: out.vectors[k], embedding_model: out.model, embedded_at: now }).eq("id", m.id);
    }));
  }
  return true;
}

/** Merge checks run at most this often per product (group samples change as groups grow, so caching alone can't bound them). */
const MERGE_CHECK_INTERVAL_HOURS = 6;

/**
 * Model check of borderline merges: cached per pair, at most maxChecks pairs, and at
 * most one round per product every MERGE_CHECK_INTERVAL_HOURS. Between rounds,
 * earlier "yes" answers still apply through the cache; unchecked pairs stay separate.
 */
async function confirmMerges(admin: SupabaseClient, ai: ResolvedAi, product: NonNullable<Awaited<ReturnType<typeof productContext>>>, productId: string, plan: ReturnType<typeof planSemantic>) {
  if (!plan.candidates.length) return [];
  const since = new Date(Date.now() - MERGE_CHECK_INTERVAL_HOURS * 3_600_000).toISOString();
  const { count: recent } = await admin.from("ai_usage_records").select("id", { count: "exact", head: true })
    .eq("product_id", productId).eq("purpose", "merge_check").neq("status", "released").gte("created_at", since);
  const mayCall = (recent ?? 0) === 0;
  const pairs = plan.candidates.map((c, i) => ({ id: `p${i + 1}`, a: groupSamples(plan, c.a), b: groupSamples(plan, c.b), cand: c }));
  const keyOf = (p: (typeof pairs)[number]) => sha256(["merge", PROMPT_VERSION, product.workspaceId, ai.client.modelFor("cheap"), JSON.stringify([p.a, p.b])].join("|"));
  const cached = await cacheGet(admin, pairs.map(keyOf));
  const verdict = new Map<string, string>();
  const todo = mayCall ? pairs.filter((p) => {
    const v = cached.get(keyOf(p)) as { same_issue?: string } | undefined;
    if (v?.same_issue) verdict.set(p.id, v.same_issue);
    return !v;
  }) : [];
  if (!mayCall) for (const p of pairs) {
    const v = cached.get(keyOf(p)) as { same_issue?: string } | undefined;
    if (v?.same_issue) verdict.set(p.id, v.same_issue);
  }
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20).map(({ id, a, b }) => ({ id, a, b }));
    const { system, user } = mergeCheckPrompt(product, batch);
    try {
      const r = await budgetedCall(admin, ai, { workspaceId: product.workspaceId, productId }, {
        purpose: "merge_check", tier: "cheap", system, user, schema: mergeCheckSchema, schemaName: "merge_check",
        maxTokens: 100 + batch.length * 30, mockInput: { pairs: batch },
      });
      const valid = new Set(batch.map((b) => b.id));
      const answers = r.output.pairs.filter((p) => valid.has(p.id));
      for (const a of answers) verdict.set(a.id, a.same_issue);
      await cachePut(admin, product.workspaceId, "merge_check", r.model, answers.map((a) => ({ key: keyOf(pairs.find((p) => p.id === a.id)!), output: { same_issue: a.same_issue } })));
    } catch (e) {
      if (e instanceof AiError && !e.retryable) break; // unconfirmed pairs simply stay separate
      throw e;
    }
  }
  return pairs.filter((p) => verdict.get(p.id) === "yes").map((p) => ({ a: p.cand.a, b: p.cand.b }));
}

/**
 * Recomputes a product's feedback issues from classified mentions: semantic
 * grouping when embeddings are available (otherwise word-based), evidence-backed
 * priority, and reconciliation so ids and team decisions survive.
 */
export async function reclusterProduct(admin: SupabaseClient, productId: string, now = new Date()): Promise<{ clusters: number; inserted: number; removed: number; grouping: Grouping }> {
  const product = await productContext(admin, productId);
  if (!product) return { clusters: 0, inserted: 0, removed: 0, grouping: "tfidf_v1" };
  // Competitors are compared on volume and sentiment; grouping their feedback into issues would spend embeddings on nothing shown.
  const { data: kind } = await admin.from("products").select("competitor_of").eq("id", productId).maybeSingle();
  if (kind?.competitor_of) return { clusters: 0, inserted: 0, removed: 0, grouping: "tfidf_v1" };
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("mentions")
    .select("id, source, title, content, author_external_id, published_at, sentiment, feedback_category, category_confidence, ai_area, ai_severity, embedding, embedding_model")
    .eq("product_id", productId)
    .eq("processing_status", "classified")
    .eq("dedup_kind", "original")
    .in("relevance_status", ["relevant", "pending", "user_relevant"])
    .neq("ai_about_product", "no")
    .in("feedback_category", [...CLUSTER_CATEGORIES])
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(MAX_MENTIONS);
  if (error) throw new Error(`load feedback: ${error.message}`);
  const rows = (data ?? []) as Row[];

  const items: ClusterInput[] = rows.map((m) => ({
    id: m.id, category: m.feedback_category, categoryConfidence: Number(m.category_confidence ?? 0.5),
    sentiment: m.sentiment ?? null, title: m.title, text: m.content ?? "",
    source: m.source, authorId: m.author_external_id ?? null, publishedAt: new Date(m.published_at).toISOString(),
    area: m.ai_area, severity: m.ai_severity,
  }));
  const exclude = new Set(tokenize([product.name, ...product.keywords].join(" "), new Set()));

  let computed: ComputedCluster[];
  let grouping: Grouping = "tfidf_v1";
  const ai = await resolveAi(admin, product.workspaceId);
  if (!("ok" in ai) && rows.length && (await ensureEmbeddings(admin, ai, product.workspaceId, productId, rows))) {
    const vec = new Map(rows.map((r) => [r.id, r.embedding ?? []]));
    const semantic: SemanticItem[] = items.map((i) => ({ ...i, vector: vec.get(i.id) ?? [] }));
    const plan = planSemantic(semantic);
    computed = finishSemantic(plan, await confirmMerges(admin, ai, product, productId, plan), exclude);
    grouping = "semantic_v1";
  } else {
    computed = clusterFeedback(items, exclude);
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const scored = computed.map((c) => {
    const members = c.memberIds.map((id) => byId.get(id)!);
    const dates = members.map((m) => m.publishedAt);
    const t = timeFacts(dates, now);
    const sentiments = members.map((m) => m.sentiment).filter((s) => s && s !== "uncertain");
    return {
      c,
      p: prioritize({
        independentReporters: c.reportCount, mentions: members.length, platforms: c.platforms, ...t,
        firstSeen: c.firstDetectedAt, lastSeen: c.lastDetectedAt, severities: members.map((m) => m.severity ?? null),
        area: c.area, confidence: c.confidence,
        negativeShare: sentiments.length ? sentiments.filter((s) => s === "negative").length / sentiments.length : 0,
      }, now),
    };
  });

  const { data: stored } = await admin.from("feedback_clusters").select("id, category, status").eq("product_id", productId);
  const existing: ExistingCluster[] = [];
  for (const c of stored ?? []) {
    const { data: members } = await admin.from("feedback_cluster_members").select("mention_id").eq("cluster_id", c.id);
    existing.push({ id: c.id as string, category: c.category as FeedbackCategory, status: c.status as ExistingCluster["status"], memberIds: (members ?? []).map((m) => m.mention_id as string) });
  }
  const plan = reconcileClusters(existing, computed);
  const pOf = new Map(scored.map((s) => [s.c, s.p]));

  for (const u of plan.updates) {
    await admin.from("feedback_clusters").update(row(u.cluster, product.workspaceId, productId, grouping, pOf.get(u.cluster)!)).eq("id", u.id);
    await replaceMembers(admin, u.id, product.workspaceId, u.cluster);
  }
  for (const c of plan.inserts) {
    const { data: ins, error: insErr } = await admin.from("feedback_clusters").insert(row(c, product.workspaceId, productId, grouping, pOf.get(c)!)).select("id").single();
    if (insErr || !ins) {
      console.error(`[ai] cluster not written (${insErr?.code ?? "db"})`);
      continue;
    }
    await replaceMembers(admin, ins.id as string, product.workspaceId, c);
  }
  if (plan.deletes.length) await admin.from("feedback_clusters").delete().in("id", plan.deletes);
  return { clusters: computed.length, inserted: plan.inserts.length, removed: plan.deletes.length, grouping };
}
