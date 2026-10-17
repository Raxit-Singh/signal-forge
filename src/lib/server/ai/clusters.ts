import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLUSTER_CATEGORIES, clusterFeedback, reconcileClusters, tokenize, type ClusterInput, type ComputedCluster, type ExistingCluster } from "@/lib/ai/cluster";
import type { FeedbackCategory, Sentiment } from "@/lib/ai/types";
import { productContext } from "./classify";

/** Feedback older than this no longer forms new issues (existing ones keep their history). */
const WINDOW_DAYS = 90;
const MAX_MENTIONS = 3000;

function row(c: ComputedCluster, workspaceId: string, productId: string) {
  return {
    workspace_id: workspaceId, product_id: productId, category: c.category, title: c.title.slice(0, 200),
    report_count: c.reportCount, unique_reporters: c.uniqueReporters, platforms: c.platforms, sentiment: c.sentiment,
    suggested_priority: c.suggestedPriority, confidence: c.confidence, first_detected_at: c.firstDetectedAt,
    last_detected_at: c.lastDetectedAt, top_terms: c.topTerms, algorithm: "tfidf_v1", computed_at: new Date().toISOString(),
  };
}

async function replaceMembers(admin: SupabaseClient, clusterId: string, workspaceId: string, c: ComputedCluster) {
  await admin.from("feedback_cluster_members").delete().eq("cluster_id", clusterId);
  const { error } = await admin.from("feedback_cluster_members").insert(
    c.memberIds.map((id) => ({ cluster_id: clusterId, mention_id: id, workspace_id: workspaceId, similarity: Math.min(1, Math.max(0, c.similarity[id] ?? 0)) })),
  );
  if (error) console.error(`[ai] cluster members not written (${error.code ?? "db"})`);
}

/**
 * Recomputes a product's feedback issues from classified mentions. Deterministic
 * and free (no model call); ids and team decisions survive (reconcileClusters).
 */
export async function reclusterProduct(admin: SupabaseClient, productId: string): Promise<{ clusters: number; inserted: number; removed: number }> {
  const product = await productContext(admin, productId);
  if (!product) return { clusters: 0, inserted: 0, removed: 0 };
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("mentions")
    .select("id, source, title, content, author_external_id, published_at, sentiment, feedback_category, category_confidence")
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

  const items: ClusterInput[] = (data ?? []).map((m) => ({
    id: m.id as string, category: m.feedback_category as FeedbackCategory, categoryConfidence: Number(m.category_confidence ?? 0.5),
    sentiment: (m.sentiment as Sentiment | null) ?? null, title: m.title as string | null, text: (m.content as string | null) ?? "",
    source: m.source as string, authorId: (m.author_external_id as string | null) ?? null, publishedAt: new Date(m.published_at as string).toISOString(),
  }));
  const exclude = new Set(tokenize([product.name, ...product.keywords].join(" "), new Set()));
  const computed = clusterFeedback(items, exclude);

  const { data: stored } = await admin.from("feedback_clusters").select("id, category, status").eq("product_id", productId);
  const existing: ExistingCluster[] = [];
  for (const c of stored ?? []) {
    const { data: members } = await admin.from("feedback_cluster_members").select("mention_id").eq("cluster_id", c.id);
    existing.push({ id: c.id as string, category: c.category as FeedbackCategory, status: c.status as ExistingCluster["status"], memberIds: (members ?? []).map((m) => m.mention_id as string) });
  }
  const plan = reconcileClusters(existing, computed);

  for (const u of plan.updates) {
    await admin.from("feedback_clusters").update(row(u.cluster, product.workspaceId, productId)).eq("id", u.id);
    await replaceMembers(admin, u.id, product.workspaceId, u.cluster);
  }
  for (const c of plan.inserts) {
    const { data: ins, error: insErr } = await admin.from("feedback_clusters").insert(row(c, product.workspaceId, productId)).select("id").single();
    if (insErr || !ins) {
      console.error(`[ai] cluster not written (${insErr?.code ?? "db"})`);
      continue;
    }
    await replaceMembers(admin, ins.id as string, product.workspaceId, c);
  }
  if (plan.deletes.length) await admin.from("feedback_clusters").delete().in("id", plan.deletes);
  return { clusters: computed.length, inserted: plan.inserts.length, removed: plan.deletes.length };
}
