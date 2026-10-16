// Re-plan one product's monitoring query groups now (instead of waiting for a keyword
// save or the daily re-sync). Same planner as the server; no platform API calls.
//
//   node scripts/resync-queries.ts --product <uuid>            # dry run: print the plan
//   node scripts/resync-queries.ts --product <uuid> --apply    # write it (svc_apply_query_groups)
//
// Writing disables groups that are no longer planned (never deletes them) and takes
// over matching rows in place, so checkpoints survive.
import { existsSync } from "node:fs";
import { applyKeywordAllowance, productKeywordAllowance } from "../src/lib/sources/entitlements.ts";
import { buildQueryGroups, resolveEnablement } from "../src/lib/sources/query-groups.ts";
import { createAdapters } from "../src/lib/sources/registry.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const args = process.argv.slice(2);
const productId = args.includes("--product") ? args[args.indexOf("--product") + 1] : undefined;
if (!productId || !/^[0-9a-f-]{36}$/i.test(productId)) {
  console.error("Usage: node scripts/resync-queries.ts --product <uuid> [--apply]");
  process.exit(1);
}
const apply = args.includes("--apply");
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const req = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "content-type": "application/json" } });
  if (!r.ok) throw new Error(`${path.split("?")[0]} → ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
};

const [product] = await req<Array<{ id: string; workspace_id: string; website_url: string | null; app_store_url: string | null; archived_at: string | null }>>(
  `products?select=id,workspace_id,website_url,app_store_url,archived_at&id=eq.${productId}`,
);
if (!product) throw new Error("Product not found");
const [aliases, settings, ctx] = await Promise.all([
  req<Array<{ term: string; kind: string; is_ambiguous: boolean; context_terms: string[] | null }>>(
    `product_aliases?select=term,kind,is_ambiguous,context_terms&product_id=eq.${productId}&enabled=eq.true`),
  req<Array<{ platform: string; enabled: boolean }>>(`product_source_settings?select=platform,enabled&product_id=eq.${productId}`),
  req<{ paid_allowance_usd: number; max_searches_per_platform: number; max_keywords: number }>("rpc/svc_schedule_context", {
    method: "POST", body: JSON.stringify({ p_product_id: productId, p_platform: "reddit" }),
  }),
]);
const env = process.env;
const adapters = createAdapters({
  githubToken: env.GITHUB_TOKEN, stackExchangeKey: env.STACKEXCHANGE_KEY, youtubeApiKey: env.YOUTUBE_API_KEY, apiDirectKey: env.API_DIRECT_API_KEY,
});
const paidOn = env.PAID_SOURCES_ENABLED === "true" && Boolean(env.API_DIRECT_API_KEY);
const enablement = product.archived_at ? [] : resolveEnablement(
  adapters, product, new Map(settings.map((s) => [s.platform, s.enabled])), Number(ctx.paid_allowance_usd ?? 0), paidOn,
);
const all = aliases.map((a) => ({ term: a.term, kind: a.kind as never, isAmbiguous: a.is_ambiguous, contextTerms: a.context_terms ?? [] }));
// Same keyword allowance as the server: shared across the workspace's active products in creation order.
const [siblings, wsAliases] = await Promise.all([
  req<Array<{ id: string; created_at: string }>>(`products?select=id,created_at&workspace_id=eq.${product.workspace_id}&archived_at=is.null`),
  req<Array<{ product_id: string }>>(`product_aliases?select=product_id&workspace_id=eq.${product.workspace_id}&enabled=eq.true`),
]);
const allowance = productKeywordAllowance(productId, siblings.map((p) => ({
  id: p.id, createdAt: p.created_at, activeKeywords: wsAliases.filter((a) => a.product_id === p.id).length,
})), Number(ctx.max_keywords ?? 10));
const { active: keywords, paused } = applyKeywordAllowance(all, allowance);
if (paused.length) console.log(`Paused (over the plan's keyword allowance of ${ctx.max_keywords}): ${paused.map((k) => k.term).join(", ")}`);
const groups = buildQueryGroups(product, keywords, enablement, adapters, {
  planMaxSearches: Number(ctx.max_searches_per_platform ?? 2), stackExchangeKey: Boolean(env.STACKEXCHANGE_KEY),
});

console.log(`Keywords: ${keywords.map((k) => k.term).join(", ") || "(none)"}`);
console.table(groups.map((g) => ({ platform: g.provider, stream: g.stream, query: g.query, terms: (g.params.terms as string[]).join(", "), rotation: g.params.rotation ? JSON.stringify(g.params.rotation) : "" })));
for (const e of enablement.filter((x) => !x.enabled)) console.log(`   ${e.id}: off — ${e.reason}`);
if (!apply) {
  console.log("Dry run. Pass --apply to write these groups.");
} else {
  const n = await req<number>("rpc/svc_apply_query_groups", { method: "POST", body: JSON.stringify({ p_product_id: productId, p_groups: groups }) });
  console.log(`Applied ${n} group(s); groups no longer planned were disabled (kept with their checkpoints).`);
}
