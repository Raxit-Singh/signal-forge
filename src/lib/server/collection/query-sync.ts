import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyKeywordAllowance, productKeywordAllowance } from "@/lib/sources/entitlements";
import { buildQueryGroups, resolveEnablement, type ProductRow } from "@/lib/sources/query-groups";
import type { OptimizerKeyword } from "@/lib/sources/query-optimizer";
import { serverEnv } from "@/lib/server/env";
import { getAdapters, paidCollectionEnabled } from "./sources";
import { connectedSources } from "./connections";

/** Keywords per competitor, including its name (matches private.competitor_max_keywords()). */
export const COMPETITOR_MAX_KEYWORDS = 3;

export { resolveEnablement, websiteDomain, type SourceEnablement } from "@/lib/sources/query-groups";

/**
 * Active keywords this product may monitor under the workspace's plan: the
 * allowance is shared by the workspace's active products in creation order.
 * Works with the service client or a member's RLS client.
 */
export async function keywordAllowanceFor(sb: SupabaseClient, productId: string, workspaceId: string, maxKeywords: number): Promise<number> {
  const [{ data: products }, { data: aliases }] = await Promise.all([
    sb.from("products").select("id, created_at, competitor_of").eq("workspace_id", workspaceId).is("archived_at", null),
    sb.from("product_aliases").select("product_id").eq("workspace_id", workspaceId).eq("enabled", true).limit(10_000),
  ]);
  // A competitor's tracking product has its own small cap (enforced in the database too).
  if ((products ?? []).some((p) => p.id === productId && p.competitor_of)) return COMPETITOR_MAX_KEYWORDS;
  const own = (products ?? []).filter((p) => !p.competitor_of);
  const counts = new Map<string, number>();
  for (const a of aliases ?? []) counts.set(a.product_id as string, (counts.get(a.product_id as string) ?? 0) + 1);
  return productKeywordAllowance(
    productId,
    own.map((p) => ({ id: p.id as string, createdAt: p.created_at as string, activeKeywords: counts.get(p.id as string) ?? 0 })),
    maxKeywords,
  );
}

/**
 * Recomputes the query groups for a product (every source) from its keywords,
 * platform capabilities and enablement, then writes the desired set (others are
 * disabled, never deleted — checkpoints survive re-enabling).
 */
export async function syncOptimizedQueries(admin: SupabaseClient, productId: string): Promise<number> {
  const { data: product } = await admin
    .from("products")
    .select("id, workspace_id, website_url, app_store_url, play_store_url, archived_at")
    .eq("id", productId)
    .maybeSingle<ProductRow>();
  if (!product) return 0;

  const [{ data: aliases }, { data: settingRows }, { data: ctx }, connected] = await Promise.all([
    admin.from("product_aliases").select("term, kind, is_ambiguous, context_terms, enabled").eq("product_id", productId).eq("enabled", true),
    admin.from("product_source_settings").select("platform, enabled").eq("product_id", productId),
    admin.rpc("svc_schedule_context", { p_product_id: productId, p_platform: "reddit" }),
    connectedSources(admin, productId, product.workspace_id),
  ]);
  const adapters = getAdapters();
  const settings = new Map((settingRows ?? []).map((r) => [r.platform as string, r.enabled as boolean]));
  const allowance = Number((ctx as { paid_allowance_usd?: number } | null)?.paid_allowance_usd ?? 0);
  const maxSearches = Number((ctx as { max_searches_per_platform?: number } | null)?.max_searches_per_platform ?? 2);
  const enablement = product.archived_at ? [] : resolveEnablement(adapters, product, settings, allowance, paidCollectionEnabled(), connected);

  const all: OptimizerKeyword[] = (aliases ?? []).map((a) => ({
    term: a.term, kind: a.kind, isAmbiguous: a.is_ambiguous, contextTerms: a.context_terms ?? [],
  }));
  // Over the plan's keyword allowance (after a downgrade): the extra keywords pause, highest priority stays.
  const maxKeywords = Number((ctx as { max_keywords?: number } | null)?.max_keywords ?? 10);
  const keywords = applyKeywordAllowance(all, await keywordAllowanceFor(admin, productId, product.workspace_id, maxKeywords)).active;
  const groups = buildQueryGroups(product, keywords, enablement, adapters, {
    planMaxSearches: maxSearches, stackExchangeKey: Boolean(serverEnv().STACKEXCHANGE_KEY),
  });

  const { data, error } = await admin.rpc("svc_apply_query_groups", { p_product_id: productId, p_groups: groups });
  if (error) throw new Error(`Couldn't save query groups (${error.code ?? "db"})`);
  return Number(data ?? 0);
}

/** Daily safety net: re-sync every active product (new server keys, plan changes, backfill). */
export async function syncAllProducts(admin: SupabaseClient, limit = 500): Promise<number> {
  const { data } = await admin.from("products").select("id").is("archived_at", null).limit(limit);
  let n = 0;
  for (const p of data ?? []) {
    try {
      await syncOptimizedQueries(admin, p.id as string);
      n++;
    } catch (e) {
      console.error(`[sync] product ${p.id}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return n;
}
