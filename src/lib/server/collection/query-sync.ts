import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { appStoreIds } from "@/lib/sources/official";
import { NON_OR_QUERY_CAP, planQueries, queryFingerprint, type MonitoringMode, type OptimizerKeyword } from "@/lib/sources/query-optimizer";
import { isLegacySource, PUBLIC_SOURCES, streamsOf } from "@/lib/sources/registry";
import type { PublicSourceId, SourceAdapter } from "@/lib/sources/types";
import { getAdapters, paidCollectionEnabled } from "./sources";

/** Free sources without OR: one query per keyword, capped to protect shared rate limits. */
const FREE_NON_OR_CAP = 5;

export interface SourceEnablement {
  id: PublicSourceId;
  enabled: boolean;
  /** Why it's off (or what it needs) — shown in Smart Monitoring. */
  reason?: string;
}

interface ProductRow {
  id: string;
  workspace_id: string;
  website_url: string | null;
  app_store_url: string | null;
  monitoring_mode: MonitoringMode;
  archived_at: string | null;
}

export function websiteDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Which optimizer-managed sources run for a product. Free official sources are
 * on by default; paid sources need the server switch, a plan that includes
 * paid sources, and the product admin turning them on.
 */
export function resolveEnablement(
  adapters: Record<PublicSourceId, SourceAdapter>,
  product: ProductRow,
  settings: Map<string, boolean>,
  paidAllowanceUsd: number,
  paidOn: boolean,
): SourceEnablement[] {
  return PUBLIC_SOURCES.filter((id) => !isLegacySource(id)).map((id): SourceEnablement => {
    const a = adapters[id];
    const set = settings.get(id);
    if (!a.configured().ok) return { id, enabled: false, reason: "Not configured on this server" };
    if (a.paid) {
      if (!paidOn) return { id, enabled: false, reason: "Paid sources are switched off on this server" };
      if (paidAllowanceUsd <= 0) return { id, enabled: false, reason: "Not included in your plan" };
      if (set !== true) return { id, enabled: false, reason: "Off — turn it on to start paid monitoring" };
    } else if (set === false) {
      return { id, enabled: false, reason: "Turned off for this product" };
    }
    if (id === "trustpilot" && !websiteDomain(product.website_url)) return { id, enabled: false, reason: "Needs your product's website" };
    if (id === "app_store" && !appStoreIds(product.app_store_url)) return { id, enabled: false, reason: "Needs your product's App Store URL" };
    return { id, enabled: true };
  });
}

/**
 * Recomputes optimizer-managed query groups for a product from its keywords,
 * platform capabilities and enablement, then writes the desired set (others are
 * disabled, never deleted — checkpoints survive re-enabling).
 */
export async function syncOptimizedQueries(admin: SupabaseClient, productId: string): Promise<number> {
  const { data: product } = await admin
    .from("products")
    .select("id, workspace_id, website_url, app_store_url, monitoring_mode, archived_at")
    .eq("id", productId)
    .maybeSingle<ProductRow>();
  if (!product) return 0;

  const [{ data: aliases }, { data: settingRows }, { data: ctx }] = await Promise.all([
    admin.from("product_aliases").select("term, kind, is_ambiguous, context_terms, enabled").eq("product_id", productId).eq("enabled", true),
    admin.from("product_source_settings").select("platform, enabled").eq("product_id", productId),
    admin.rpc("svc_schedule_context", { p_product_id: productId, p_platform: "reddit" }),
  ]);
  const adapters = getAdapters();
  const settings = new Map((settingRows ?? []).map((r) => [r.platform as string, r.enabled as boolean]));
  const allowance = Number((ctx as { paid_allowance_usd?: number } | null)?.paid_allowance_usd ?? 0);
  const enablement = product.archived_at ? [] : resolveEnablement(adapters, product, settings, allowance, paidCollectionEnabled());

  const keywords: OptimizerKeyword[] = (aliases ?? []).map((a) => ({
    term: a.term, kind: a.kind, isAmbiguous: a.is_ambiguous, contextTerms: a.context_terms ?? [],
  }));
  const domain = websiteDomain(product.website_url);
  const app = appStoreIds(product.app_store_url);

  const groups: Array<Record<string, unknown>> = [];
  for (const e of enablement.filter((x) => x.enabled)) {
    const a = adapters[e.id];
    for (const s of streamsOf(a)) {
      const shared = a.shareable !== false && Boolean(a.shareable);
      const filters: Record<string, string> = shared ? {} : { product: productId };
      if (s.queryMode === "product") {
        const query = e.id === "trustpilot" ? domain : app ? `app:${app.id}:${app.country}` : null;
        if (!query) continue;
        groups.push({
          provider: e.id, stream: s.id, query,
          params: { terms: [], role: "product" },
          fingerprint: queryFingerprint({ platform: e.id, stream: s.id, expression: query, filters }),
          plan: { role: "product", terms: [] },
        });
        continue;
      }
      if (keywords.length === 0) continue;
      const cap = a.paid ? NON_OR_QUERY_CAP[product.monitoring_mode] : FREE_NON_OR_CAP;
      const plan = planQueries(keywords, s.capabilities, cap);
      for (const g of plan.groups) {
        groups.push({
          provider: e.id, stream: s.id, query: g.expression,
          params: { terms: g.terms, role: g.role },
          fingerprint: queryFingerprint({ platform: e.id, stream: s.id, expression: g.expression, filters }),
          plan: { role: g.role, terms: g.terms, skipped: plan.skipped },
        });
      }
    }
  }

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
