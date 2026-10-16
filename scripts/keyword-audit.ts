// Keyword engine audit (read-only, no platform API calls, nothing written).
//
//   node scripts/keyword-audit.ts [--product <uuid>] [--keywords "Octolens:exact_name,octolens.com:domain,…"]
//
// --keywords replaces the stored keywords with a hypothetical set (labelled as such) to
// show how a fuller keyword list would be planned; nothing is saved.
//
// For every active product: configured keywords, the exact query groups each
// platform runs per check (the same planner the worker uses), what isn't
// searched and why, and estimated monthly request volume and API Direct cost
// from the provider_pricing registry. Estimates assume the default 2 pages per
// check and no saturation; actual spend is in api_cost_ledger.
import { existsSync } from "node:fs";
import { expansionsPerRun } from "../src/lib/sources/adaptive.ts";
import { ENDPOINTS, type EndpointSpec } from "../src/lib/sources/apidirect/endpoints.ts";
import { planPlatformKeywords, rotationTurns } from "../src/lib/sources/keyword-plan.ts";
import { createAdapters, isLegacySource, PUBLIC_SOURCES, streamsOf } from "../src/lib/sources/registry.ts";
import type { PublicSourceId } from "../src/lib/sources/types.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const args = process.argv.slice(2);
const only = args.includes("--product") ? args[args.indexOf("--product") + 1] : null;
const simulated = args.includes("--keywords")
  ? args[args.indexOf("--keywords") + 1]!.split(",").map((x) => {
    const [term, kind = "exact_name"] = x.split(":");
    return { term: term!.trim(), kind: kind as never, isAmbiguous: false, contextTerms: [] as string[] };
  })
  : null;
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const get = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "content-type": "application/json" } });
  if (!r.ok) throw new Error(`${path.split("?")[0]} → ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
};

/** Endpoint per platform stream, and the comment-expansion endpoint where one exists. */
const STREAM_ENDPOINT: Record<string, EndpointSpec> = {
  "reddit/posts": ENDPOINTS.redditPosts, "reddit/comments": ENDPOINTS.redditComments, "x/posts": ENDPOINTS.xPosts,
  "linkedin/posts": ENDPOINTS.linkedinPosts, "tiktok/videos": ENDPOINTS.tiktokVideos, "instagram/posts": ENDPOINTS.instagramPosts,
  "facebook/posts": ENDPOINTS.facebookPosts, "substack/posts": ENDPOINTS.substackPosts, "substack/notes": ENDPOINTS.substackNotes,
  "web/results": ENDPOINTS.webSearch, "news/articles": ENDPOINTS.newsArticles, "trustpilot/reviews": ENDPOINTS.trustpilotReviews,
};
const EXPANSION: Partial<Record<PublicSourceId, EndpointSpec>> = {
  x: ENDPOINTS.xTweetComments, tiktok: ENDPOINTS.tiktokVideoComments, instagram: ENDPOINTS.instagramPostComments, facebook: ENDPOINTS.facebookPostComments,
};
const DEFAULT_PAGES = 2;
const round = (n: number) => Math.round(n * 100) / 100;
const MONTH_MIN = 30 * 1440;

const prices = new Map<string, number>();
for (const p of await get<Array<{ pricing_key: string; price_usd: number }>>("provider_pricing?select=pricing_key,price_usd,effective_from&order=effective_from.desc")) {
  if (!prices.has(p.pricing_key)) prices.set(p.pricing_key, Number(p.price_usd));
}
const adapters = createAdapters({ apiDirectKey: "audit-only", youtubeApiKey: "audit-only" });
const products = await get<Array<{ id: string; name: string; workspace_id: string; website_url: string | null; app_store_url: string | null }>>(
  `products?select=id,name,workspace_id,website_url,app_store_url&archived_at=is.null${only ? `&id=eq.${only}` : ""}&order=created_at`,
);

for (const product of products) {
  const [aliases, queries, activity, ctx] = await Promise.all([
    get<Array<{ term: string; kind: string; is_ambiguous: boolean; context_terms: string[] | null }>>(
      `product_aliases?select=term,kind,is_ambiguous,context_terms&product_id=eq.${product.id}&enabled=eq.true&order=created_at`),
    get<Array<{ provider: string; stream: string; enabled: boolean }>>(`monitoring_queries?select=provider,stream,enabled&product_id=eq.${product.id}&enabled=eq.true`),
    get<Array<{ platform: string; interval_minutes: number; score: number | null; phase: string }>>(`platform_activity?select=platform,interval_minutes,score,phase&product_id=eq.${product.id}`),
    get<{ plan_name: string; plan_min_minutes: number; max_searches_per_platform: number }>("rpc/svc_schedule_context", {
      method: "POST", body: JSON.stringify({ p_product_id: product.id, p_platform: "reddit" }),
    }),
  ]);
  const keywords = simulated ?? aliases.map((a) => ({ term: a.term, kind: a.kind as never, isAmbiguous: a.is_ambiguous, contextTerms: a.context_terms ?? [] }));
  const act = new Map(activity.map((a) => [a.platform, a]));
  console.log(`\n## ${product.name} (${product.id})`);
  console.log(`Plan: ${ctx.plan_name}, at most every ${ctx.plan_min_minutes / 60} h; paid platforms without OR: ${ctx.max_searches_per_platform} searches per check`);
  if (simulated) console.log("HYPOTHETICAL keyword set (--keywords): not the product's stored keywords.");
  console.log(`${simulated ? "Simulated" : "Configured"} keywords (${keywords.length}): ${keywords.map((k) => `${k.term} [${k.kind}${k.isAmbiguous ? ", ambiguous" : ""}]`).join(", ")}`);

  const rows: Array<Record<string, string | number>> = [];
  let paidLow = 0;
  let paidHigh = 0;
  for (const id of PUBLIC_SOURCES) {
    const a = adapters[id];
    const plan = planPlatformKeywords(id, a, keywords, {
      planMaxSearches: ctx.max_searches_per_platform, stackExchangeKey: Boolean(process.env.STACKEXCHANGE_KEY),
    });
    const running = queries.filter((q) => q.provider === id).length;
    const interval = act.get(id)?.interval_minutes ?? Math.max(ctx.plan_min_minutes, a.paid ? 360 : 240);
    const checks = MONTH_MIN / interval;
    let reqLow = 0;
    let reqHigh = 0;
    let costLow = 0;
    let costHigh = 0;
    for (const s of streamsOf(a)) {
      const sp = plan.streams.find((x) => x.stream === s.id);
      // Review feeds of the product's own page run only when the product has that page.
      const hasPage = id === "trustpilot" ? Boolean(product.website_url) : Boolean(product.app_store_url);
      // Searches per check: a rotating search runs once every `turns` checks.
      const groups = sp?.productOnly ? (hasPage ? 1 : 0)
        : (sp?.groups ?? []).reduce((t, g) => t + (g.rotation ? 1 / rotationTurns(g.rotation, interval) : 1), 0);
      const pages = Math.min(DEFAULT_PAGES, s.capabilities.maxPagesPerRun);
      const ep = STREAM_ENDPOINT[`${id}/${s.id}`];
      // "pages" endpoints bill every page requested; page-by-page endpoints stop early when results run out.
      const low = groups * (ep?.billing === "pages" ? pages : 1);
      const high = groups * pages;
      reqLow += low;
      reqHigh += high;
      if (ep) {
        const price = prices.get(ep.pricingKey) ?? NaN;
        costLow += low * price;
        costHigh += high * price;
      }
    }
    const exp = EXPANSION[id];
    if (exp) {
      const n = expansionsPerRun(act.get(id)?.phase === "ranked" ? act.get(id)!.score : null);
      reqHigh += n;
      costHigh += n * (prices.get(exp.pricingKey) ?? NaN);
    }
    const monthLow = costLow * checks;
    const monthHigh = costHigh * checks;
    if (a.paid) {
      paidLow += monthLow;
      paidHigh += monthHigh;
    }
    const kwSearched = plan.searched.length;
    rows.push({
      platform: id + (a.paid ? " (paid)" : ""),
      or: plan.booleanOr || "no",
      searches: plan.productOnly ? "product page" : plan.searches,
      running,
      "kw monitored": plan.productOnly ? "-" : `${plan.keywords.filter((k) => k.status !== "unsupported").length}/${plan.keywords.length}`,
      consolidation: plan.productOnly || plan.searches === 0 ? "-" : `${kwSearched}:${plan.searches}`,
      "every (h)": interval / 60,
      rotating: plan.keywords.filter((k) => k.status === "rotating").length,
      "requests/check": reqLow === reqHigh ? round(reqLow) : `${round(reqLow)}-${round(reqHigh)}`,
      "requests/month": `${Math.round(reqLow * checks)}-${Math.round(reqHigh * checks)}`,
      "USD/month": a.paid ? `${monthLow.toFixed(2)}-${monthHigh.toFixed(2)}` : "free",
    });
    const notes = plan.keywords.filter((k) => k.status === "unsupported").map((k) => `   - "${k.term}" can't be searched on ${id}: ${k.detail}`);
    const separate = !plan.booleanOr && plan.separate.length > 1 ? [`   - ${id}: no OR support; separate searches: ${plan.separate.join(", ")}`] : [];
    if (notes.length || separate.length) rows[rows.length - 1]!.notes = [...separate, ...notes].join("\n");
    if (!simulated && !isLegacySource(id) && running !== plan.searches && running > 0) {
      rows[rows.length - 1]!.mismatch = `stored groups ${running} vs planned ${plan.searches} (re-sync pending)`;
    }
  }
  console.table(rows.map(({ notes: _n, ...r }) => r));
  for (const r of rows) if (r.notes) console.log(r.notes);
  console.log(`Paid platforms, if all were enabled at these intervals: about $${paidLow.toFixed(2)}–$${paidHigh.toFixed(2)} a month (before API Direct's 50 free requests per endpoint per month).`);
}
