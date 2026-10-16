// Paid monitoring cost and keyword-freshness simulation for Pro and Scale
// (read-only: reads provider_pricing, makes NO platform or API Direct calls).
//
//   node scripts/simulate-plan-costs.ts [--json]
//
// Uses the production planner (OR consolidation, Reddit posts + comments streams,
// fair rotation within max_searches_per_platform), plan keyword targets
// (applyKeywordTarget) and models per endpoint:
//   * billing — page-loop endpoints (Reddit posts, LinkedIn, Substack posts) pay
//     only for pages fetched (stop on a short page); `pages=N` endpoints (Reddit
//     comments, X, TikTok, Instagram, Facebook, Substack notes, web, Trustpilot)
//     pay for every requested page, results or not; News is one charge.
//   * pages — the monitor's default of 2 (capped per platform), +1 after a
//     saturated run, as in monitor.ts. "Right-sized" = pages that fit the volume.
//   * comment expansion on X/TikTok/Instagram/Facebook: expansionsPerRun(score)
//     parents per check (only posts with ≥3 comments; assumed 30 % of results).
//   * pacing — like the server's paceForBudget, but with interval-dependent cost.
// Result volumes per keyword are ASSUMPTIONS (below), page sizes are from the
// live test (2026-10-16). Output is an estimate, not a measurement.
import { existsSync } from "node:fs";
import { expansionsPerRun, INTERVAL_STEPS, MAX_INTERVAL } from "../src/lib/sources/adaptive.ts";
import { ENDPOINTS, STREAM_ENDPOINTS } from "../src/lib/sources/apidirect/endpoints.ts";
import { CAPS } from "../src/lib/sources/capabilities.ts";
import { applyKeywordTarget } from "../src/lib/sources/entitlements.ts";
import { planPlatformKeywords, rotationTurns, type Rotation } from "../src/lib/sources/keyword-plan.ts";
import type { OptimizerKeyword } from "../src/lib/sources/query-optimizer.ts";
import { createAdapters, PAID_SOURCES } from "../src/lib/sources/registry.ts";
import type { PaidSourceId } from "../src/lib/sources/types.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const prices: Record<string, number> = {};
for (const p of (await (await fetch(`${SB}/rest/v1/provider_pricing?select=pricing_key,price_usd,effective_from&order=effective_from.desc`, {
  headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
})).json()) as Array<{ pricing_key: string; price_usd: number }>) {
  if (!(p.pricing_key in prices)) prices[p.pricing_key] = Number(p.price_usd);
}

// ---------------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------------
type Vol = "brand" | "category" | "competitor";
type Stream = "reddit/posts" | "reddit/comments" | "x/posts" | "linkedin/posts" | "tiktok/videos" | "instagram/posts"
  | "facebook/posts" | "substack/posts" | "substack/notes" | "web/results" | "news/articles" | "trustpilot/reviews";
/** Matching results per day per keyword (ASSUMPTION, typical B2B SaaS; brand = the product's own names). */
const DAILY: Record<Vol, Partial<Record<Stream, number>>> = {
  brand: { "reddit/posts": 0.5, "reddit/comments": 2, "x/posts": 4, "linkedin/posts": 2, "tiktok/videos": 0.2, "instagram/posts": 0.2, "facebook/posts": 0.2, "substack/posts": 0.2, "substack/notes": 0.5, "news/articles": 0.3, "trustpilot/reviews": 0.3 },
  category: { "reddit/posts": 6, "reddit/comments": 40, "x/posts": 80, "linkedin/posts": 30, "tiktok/videos": 8, "instagram/posts": 5, "facebook/posts": 4, "substack/posts": 3, "substack/notes": 10, "news/articles": 3 },
  competitor: { "reddit/posts": 3, "reddit/comments": 20, "x/posts": 40, "linkedin/posts": 15, "tiktok/videos": 3, "instagram/posts": 2, "facebook/posts": 2, "substack/posts": 1, "substack/notes": 4, "news/articles": 2 },
};
/** Results per page (live test 2026-10-16; docs where not observed). */
const PER_PAGE: Record<Stream, number> = {
  "reddit/posts": 20, "reddit/comments": 22, "x/posts": 20, "linkedin/posts": 20, "tiktok/videos": 25, "instagram/posts": 8,
  "facebook/posts": 10, "substack/posts": 20, "substack/notes": 5, "web/results": 10, "news/articles": 100, "trustpilot/reviews": 20,
};
const PAGE_LOOP = new Set<Stream>(["reddit/posts", "linkedin/posts", "substack/posts"]);
const EXPANSION: Partial<Record<PaidSourceId, string>> = { x: "x.tweet_comments", tiktok: "tiktok.video_comments", instagram: "instagram.post_comments", facebook: "facebook.post_comments" };
const CAP: Record<Stream, number> = {
  "reddit/posts": CAPS.redditPosts.maxPagesPerRun, "reddit/comments": CAPS.redditComments.maxPagesPerRun, "x/posts": CAPS.xPosts.maxPagesPerRun,
  "linkedin/posts": CAPS.linkedinPosts.maxPagesPerRun, "tiktok/videos": CAPS.tiktokVideos.maxPagesPerRun, "instagram/posts": CAPS.instagramPosts.maxPagesPerRun,
  "facebook/posts": CAPS.facebookPosts.maxPagesPerRun, "substack/posts": CAPS.substackPosts.maxPagesPerRun, "substack/notes": CAPS.substackNotes.maxPagesPerRun,
  "web/results": CAPS.webSearch.maxPagesPerRun, "news/articles": 1, "trustpilot/reviews": CAPS.trustpilotReviews.maxPagesPerRun,
};
const DEFAULT_PAGES = 2;

const kw = (term: string, kind: OptimizerKeyword["kind"] = "custom"): OptimizerKeyword => ({ term, kind, isAmbiguous: false, contextTerms: [] });
const COMPETITORS = ["Brand24", "Syften", "Mention", "Talkwalker", "Awario", "Brandwatch", "Sprout Social", "Meltwater", "Hootsuite Insights", "F5Bot"];
const CATEGORY = ["social listening tool", "brand monitoring software", "reddit monitoring", "mention tracking", "customer feedback tool",
  "sentiment analysis tool", "community monitoring", "social media monitoring", "brand mentions", "share of voice",
  "product feedback", "voice of customer", "competitor monitoring", "keyword alerts"];
const TEN: OptimizerKeyword[] = [
  kw("Acmely", "exact_name"), kw("acmely.io", "domain"), kw("@acmelyhq", "handle"), kw("Acmely app", "misspelling"),
  kw("Acmely pricing"), kw("Acmely review"), CATEGORY.slice(0, 2).map((t) => kw(t)), kw("Brand24"), kw("Syften"),
].flat();
const FORTY: OptimizerKeyword[] = [
  kw("Acmely", "exact_name"), kw("acmely.io", "domain"), kw("@acmelyhq", "handle"), kw("Acmelly", "misspelling"), kw("Acmely app", "misspelling"), kw("Acme-ly", "misspelling"),
  ...["pricing", "review", "alternative", "login", "API", "Slack integration"].map((x) => kw(`Acmely ${x}`)),
  ...CATEGORY.map((t) => kw(t)), ...COMPETITORS.map((t) => kw(t)), ...["track Reddit mentions", "monitor Hacker News", "alerts for brand mentions", "AI social listening"].map((t) => kw(t)),
];
const volOf = (term: string): Vol => (COMPETITORS.includes(term) ? "competitor" : /acme/i.test(term) || term.startsWith("@") ? "brand" : "category");

interface Profile { name: string; brandX: number; interval: number; score: number }
const PROFILES: Profile[] = [
  { name: "quiet product", brandX: 0.5, interval: 1440, score: 20 },
  { name: "typical product", brandX: 1, interval: 360, score: 50 },
  { name: "busy product", brandX: 10, interval: 120, score: 80 },
];
interface Plan { name: string; floor: number; target: number; searches: number; budget: number }
const PLANS: Plan[] = [
  { name: "Pro", floor: 60, target: 1440, searches: 2, budget: 25 },
  { name: "Pro", floor: 60, target: 1440, searches: 2, budget: 35 },
  { name: "Scale", floor: 60, target: 360, searches: 4, budget: 75 },
  { name: "Scale", floor: 60, target: 360, searches: 4, budget: 100 },
];

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
const adapters = createAdapters({ apiDirectKey: "simulation" });
interface Search { stream: Stream; daily: number; rotation: Rotation | null; brand: boolean }

function searchesFor(id: PaidSourceId, keywords: OptimizerKeyword[], plan: Plan, profile: Profile): Search[] {
  const kp = planPlatformKeywords(id, adapters[id], keywords, { planMaxSearches: plan.searches });
  const out: Search[] = [];
  for (const s of kp.streams) {
    const stream = `${id}/${s.stream}` as Stream;
    if (s.productOnly) {
      out.push({ stream, daily: (DAILY.brand[stream] ?? 0) * profile.brandX, rotation: null, brand: true });
      continue;
    }
    for (const g of s.groups) {
      // A group finds what each of its terms finds (covered keywords add nothing: their results contain the broader term).
      const daily = g.terms.reduce((t, term) => {
        const v = volOf(term);
        return t + (DAILY[v][stream] ?? 0) * (v === "brand" ? profile.brandX : 1);
      }, 0);
      out.push({ stream, daily, rotation: g.rotation, brand: g.terms.every((t) => volOf(t) === "brand") });
    }
  }
  return out;
}

interface CheckCost { usd: number; expansionUsd: number; saturated: number; brandSaturated: number; commentsUsd: number }
function checkCost(id: PaidSourceId, searches: Search[], interval: number, profile: Profile, rightSized: boolean): CheckCost {
  let usd = 0;
  let saturated = 0;
  let brandSaturated = 0;
  let commentsUsd = 0;
  let resultsForExpansion = 0;
  for (const s of searches) {
    const turns = s.rotation ? rotationTurns(s.rotation) : 1;
    const results = s.daily * (interval * turns) / 1440; // a turn searches everything since its last turn
    const per = PER_PAGE[s.stream];
    const cap = CAP[s.stream];
    const needed = Math.max(1, Math.ceil(results / per));
    const sat = needed > cap;
    let pages: number;
    if (s.stream === "news/articles") pages = 1;
    else if (PAGE_LOOP.has(s.stream)) pages = Math.min(cap, Math.floor(results / per) + 1);
    else pages = rightSized ? Math.min(cap, needed) : Math.min(cap, Math.max(Math.min(DEFAULT_PAGES, cap), sat ? cap : needed));
    const ep = STREAM_ENDPOINTS[s.stream]!;
    const c = (prices[ep.pricingKey] ?? 0) * pages / turns; // a rotating search runs every `turns` checks
    usd += c;
    if (s.stream === "reddit/comments") commentsUsd += c;
    if (sat) {
      saturated += 1 / turns;
      if (s.brand) brandSaturated += 1 / turns;
    }
    resultsForExpansion += Math.min(results, cap * per) / turns;
  }
  let expansionUsd = 0;
  const exp = EXPANSION[id];
  if (exp) expansionUsd = Math.min(expansionsPerRun(profile.score), Math.floor(resultsForExpansion * 0.3)) * (prices[exp] ?? 0);
  return { usd: usd + expansionUsd, expansionUsd, saturated, brandSaturated, commentsUsd };
}

const MONTH = 30 * 1440;
function simulate(keywords: OptimizerKeyword[], plan: Plan, profile: Profile, rightSized: boolean) {
  const rows = PAID_SOURCES.map((id) => {
    const searches = searchesFor(id, keywords, plan, profile);
    const rotations = searches.map((s) => s.rotation).filter((r): r is Rotation => Boolean(r));
    const t = applyKeywordTarget({ platformName: adapters[id].name, interval: Math.max(plan.floor, profile.interval), rotations, targetMinutes: plan.target, floorMinutes: plan.floor, planName: plan.name });
    const turns = Math.max(1, ...rotations.map((r) => rotationTurns(r)));
    return { id, searches, interval: t.interval, turns };
  });
  const monthly = () => rows.reduce((t, r) => t + checkCost(r.id, r.searches, r.interval, profile, rightSized).usd * (MONTH / r.interval), 0);
  const unpaced = monthly();
  // Pacing: lengthen the platform with the highest spend rate one step until it fits.
  for (let guard = 0; monthly() > plan.budget && guard < 200; guard++) {
    const next = rows.filter((r) => r.interval < MAX_INTERVAL)
      .sort((a, b) => checkCost(b.id, b.searches, b.interval, profile, rightSized).usd / b.interval - checkCost(a.id, a.searches, a.interval, profile, rightSized).usd / a.interval)[0];
    if (!next) break;
    next.interval = INTERVAL_STEPS.find((s) => s > next.interval) ?? MAX_INTERVAL;
  }
  const detail = rows.map((r) => {
    const c = checkCost(r.id, r.searches, r.interval, profile, rightSized);
    const slowest = r.interval * r.turns;
    return {
      platform: r.id, searches: r.searches.length, interval_h: r.interval / 60, slowest_keyword_h: slowest / 60, target_met: slowest <= plan.target,
      usd_month: c.usd * (MONTH / r.interval), expansion_usd: c.expansionUsd * (MONTH / r.interval), comments_usd: c.commentsUsd * (MONTH / r.interval),
      saturated_per_check: c.saturated, brand_saturated: c.brandSaturated,
    };
  });
  const paced = detail.reduce((t, d) => t + d.usd_month, 0);
  const orPlatforms = new Set(["reddit", "x", "linkedin", "web", "news"]);
  const misses = detail.filter((d) => !d.target_met);
  const acceptable = paced <= plan.budget + 1e-9
    && detail.filter((d) => orPlatforms.has(d.platform)).every((d) => d.target_met)
    && detail.every((d) => d.slowest_keyword_h * 60 <= plan.target * 2)
    && detail.every((d) => d.brand_saturated === 0);
  return {
    unpaced, paced, acceptable, detail,
    misses: misses.map((d) => `${d.platform} ${d.slowest_keyword_h.toFixed(0)}h`),
    expansion: detail.reduce((t, d) => t + d.expansion_usd, 0),
    comments: detail.reduce((t, d) => t + d.comments_usd, 0),
    saturatedSearches: detail.reduce((t, d) => t + d.saturated_per_check, 0),
    brandSaturated: detail.reduce((t, d) => t + d.brand_saturated, 0),
  };
}

const rows: Array<Record<string, unknown>> = [];
const json: Record<string, unknown> = {};
for (const [label, keywords, planNames] of [["10 keywords", TEN, ["Pro", "Scale"]], ["40 keywords", FORTY, ["Scale"]]] as const) {
  for (const plan of PLANS.filter((p) => (planNames as readonly string[]).includes(p.name))) {
    for (const profile of PROFILES) {
      for (const rightSized of [false, true]) {
        const r = simulate(keywords as OptimizerKeyword[], plan, profile, rightSized);
        const key = `${plan.name} $${plan.budget} · ${label} · ${profile.name}${rightSized ? " · right-sized pages" : ""}`;
        json[key] = r;
        rows.push({
          scenario: key, unpaced: `$${r.unpaced.toFixed(2)}`, paced: `$${r.paced.toFixed(2)}`, "reddit comments": `$${r.comments.toFixed(2)}`,
          expansion: `$${r.expansion.toFixed(2)}`, "target misses (slowest keyword)": r.misses.join(", ") || "none",
          "saturated searches/check": r.saturatedSearches.toFixed(1), acceptable: r.acceptable ? "yes" : "no",
        });
      }
    }
  }
}
if (process.argv.includes("--json")) console.log(JSON.stringify(json, null, 2));
else {
  console.log(`Keywords: 10 = ${TEN.map((k) => k.term).join(", ")}`);
  console.log(`          40 = ${FORTY.length} (brand ${FORTY.filter((k) => volOf(k.term) === "brand").length}, category ${FORTY.filter((k) => volOf(k.term) === "category").length}, competitors ${FORTY.filter((k) => volOf(k.term) === "competitor").length})`);
  console.table(rows);
  console.log("Acceptable = paced spend ≤ budget, plan target met on OR platforms, every platform within 2× target, no brand search saturated.");
  console.log("Estimates only: volumes are assumptions; prices from provider_pricing; first 50 requests/endpoint/month free (ignored).");
}
void ENDPOINTS;
