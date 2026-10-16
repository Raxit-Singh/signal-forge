// Desired monitoring query groups for one product (pure). The server's query
// sync and scripts/resync-queries.ts write the result with svc_apply_query_groups.

import { planPlatformKeywords, type BudgetOptions } from "./keyword-plan.ts";
import { appStoreIds } from "./official.ts";
import { queryFingerprint, type OptimizerKeyword } from "./query-optimizer.ts";
import { isLegacySource, PUBLIC_SOURCES, streamsOf } from "./registry.ts";
import type { PublicSourceId, SourceAdapter } from "./types.ts";

export interface SourceEnablement {
  id: PublicSourceId;
  enabled: boolean;
  /** Why it's off (or what it needs) — shown in Smart Monitoring. */
  reason?: string;
}

export interface ProductRow {
  id: string;
  workspace_id: string;
  website_url: string | null;
  app_store_url: string | null;
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
 * Which sources run for a product. Milestone 2 sources follow the keywords
 * whenever the server can call them; free official sources are on by default;
 * paid sources need the server switch, a plan that includes paid sources, and
 * the product admin turning them on.
 */
export function resolveEnablement(
  adapters: Record<PublicSourceId, SourceAdapter>,
  product: Pick<ProductRow, "website_url" | "app_store_url">,
  settings: Map<string, boolean>,
  paidAllowanceUsd: number,
  paidOn: boolean,
): SourceEnablement[] {
  return PUBLIC_SOURCES.map((id): SourceEnablement => {
    const a = adapters[id];
    const set = settings.get(id);
    if (!a.configured().ok) return { id, enabled: false, reason: "Not configured on this server" };
    if (isLegacySource(id)) return { id, enabled: true };
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

export interface QueryGroupRow {
  provider: PublicSourceId;
  stream: string;
  query: string;
  params: Record<string, unknown>;
  fingerprint: string;
  plan: Record<string, unknown>;
}

/** Every query group the product should have (others get disabled, keeping their checkpoints). */
export function buildQueryGroups(
  product: ProductRow,
  keywords: OptimizerKeyword[],
  enablement: SourceEnablement[],
  adapters: Record<PublicSourceId, SourceAdapter>,
  budget: BudgetOptions,
): QueryGroupRow[] {
  const domain = websiteDomain(product.website_url);
  const app = appStoreIds(product.app_store_url);
  const groups: QueryGroupRow[] = [];
  for (const e of enablement.filter((x) => x.enabled)) {
    const a = adapters[e.id];
    const shared = a.shareable !== false && Boolean(a.shareable);
    const filters: Record<string, string> = shared ? {} : { product: product.id };
    const plan = keywords.length ? planPlatformKeywords(e.id, a, keywords, budget) : null;
    for (const s of streamsOf(a)) {
      if (s.queryMode === "product") {
        const query = e.id === "trustpilot" ? domain : app ? `app:${app.id}:${app.country}` : null;
        if (!query) continue;
        groups.push({
          provider: e.id, stream: s.id, query, params: { terms: [], role: "product" },
          fingerprint: queryFingerprint({ platform: e.id, stream: s.id, expression: query, filters }),
          plan: { role: "product", terms: [] },
        });
        continue;
      }
      const sp = plan?.streams.find((x) => x.stream === s.id);
      for (const g of sp?.groups ?? []) {
        groups.push({
          provider: e.id, stream: s.id, query: g.expression,
          params: { terms: g.terms, role: g.role, ...(g.rotation ? { rotation: g.rotation } : {}) },
          fingerprint: queryFingerprint({ platform: e.id, stream: s.id, expression: g.expression, filters }),
          plan: { role: g.role, terms: g.terms, rotation: g.rotation, skipped: sp!.skipped },
        });
      }
    }
  }
  return groups;
}
