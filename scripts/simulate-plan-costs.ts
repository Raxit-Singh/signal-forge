// Paid monitoring cost and keyword-freshness simulation for Pro and Scale
// (read-only: reads provider_pricing, makes NO platform or API Direct calls).
//
//   node scripts/simulate-plan-costs.ts [--json] [--v1]
//
// Two models:
//   * V2 (default): the Discovery Engine V2 as implemented — arrival-rate intervals
//     (decidePlatformIntervalV2), brand-safe pacing (paceForBudgetSafely), right-sized
//     pages (pagesToRequest) with one escalation, continuation jobs for resumable
//     sources, out-of-turn checks for rotating searches at overflow risk, and the
//     collection profiles' provider limits. Reports cost, expected mentions found,
//     completeness, effective keyword intervals, budget and saturation risk, plus
//     30-day and 1-year historical backfills.
//   * V1 (--v1): the previous model (fixed 2 pages, score intervals), kept for comparison.
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
import { applyKeywordTarget, CHECK_OVERLAP_MINUTES } from "../src/lib/sources/entitlements.ts";
import { assessRisk, decidePlatformIntervalV2, importanceShares, paceForBudgetSafely, snapDown, type GroupModel } from "../src/lib/sources/adaptive-v2.ts";
import { emptyEstimate, pagesToRequest, updateEstimate, upperRate, type GroupEstimate } from "../src/lib/sources/arrival.ts";
import { collectionProfile, planningCapacity } from "../src/lib/sources/collection-profile.ts";
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
/** V1 per-run page caps as they were before V2 (2026-10-16), frozen for the comparison. */
const CAP: Record<Stream, number> = {
  "reddit/posts": 3, "reddit/comments": 3, "x/posts": 3, "linkedin/posts": 2, "tiktok/videos": 2, "instagram/posts": 1,
  "facebook/posts": 2, "substack/posts": 2, "substack/notes": 2, "web/results": 1, "news/articles": 1, "trustpilot/reviews": 2,
};
/** V2 per-job safety bounds (current capabilities). */
const CAP_V2: Record<Stream, number> = {
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
interface Plan { name: string; floor: number; target: number; searches: number; budget: number; allowance: number }
const PLANS: Plan[] = [
  { name: "Pro", floor: 60, target: 1440, searches: 2, budget: 25, allowance: 15000 },
  { name: "Pro", floor: 60, target: 1440, searches: 2, budget: 35, allowance: 15000 },
  { name: "Scale", floor: 60, target: 360, searches: 4, budget: 75, allowance: 50000 },
  { name: "Scale", floor: 60, target: 360, searches: 4, budget: 100, allowance: 50000 },
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

// ---------------------------------------------------------------------------
// V2 model (the engine as implemented)
// ---------------------------------------------------------------------------
/** Share of a search's results that are relevant (ASSUMPTION): own names are precise, category terms noisy. */
const RELEVANT: Record<Vol, number> = { brand: 0.85, category: 0.25, competitor: 0.3 };

interface ProfileV2 { name: string; brandX: number; categoryX: number; brandRelevant?: number; note: string }
const PROFILES_V2: ProfileV2[] = [
  { name: "small product", brandX: 0.3, categoryX: 1, note: "few brand mentions" },
  { name: "growing product", brandX: 1, categoryX: 1, note: "baseline assumptions" },
  { name: "popular product", brandX: 10, categoryX: 1, note: "10× brand volume" },
  { name: "broad brand keyword", brandX: 150, categoryX: 1, brandRelevant: 0.08, note: "brand name is a common word (\"Notion\"-like): 150× volume, 8% relevant" },
  { name: "quiet platforms", brandX: 0.05, categoryX: 0.1, note: "almost nothing on paid platforms" },
  { name: "high-volume platforms", brandX: 1, categoryX: 3, note: "3× category/competitor volume" },
];

interface SearchV2 extends Search { relShare: number; id: string }

function searchesV2(id: PaidSourceId, keywords: OptimizerKeyword[], plan: Plan, p: ProfileV2): SearchV2[] {
  const kp = planPlatformKeywords(id, adapters[id], keywords, { planMaxSearches: plan.searches });
  const out: SearchV2[] = [];
  let n = 0;
  for (const st of kp.streams) {
    const stream = `${id}/${st.stream}` as Stream;
    const brandRel = p.brandRelevant ?? RELEVANT.brand;
    if (st.productOnly) {
      out.push({ id: `${stream}#${n++}`, stream, daily: (DAILY.brand[stream] ?? 0) * p.brandX, relShare: brandRel, rotation: null, brand: true });
      continue;
    }
    for (const g of st.groups) {
      let daily = 0;
      let rel = 0;
      for (const term of g.terms) {
        const v = volOf(term);
        const d = (DAILY[v][stream] ?? 0) * (v === "brand" ? p.brandX : p.categoryX);
        daily += d;
        rel += d * (v === "brand" ? brandRel : RELEVANT[v]);
      }
      out.push({ id: `${stream}#${n++}`, stream, daily, relShare: daily > 0 ? rel / daily : 0, rotation: g.rotation, brand: g.terms.every((t) => volOf(t) === "brand") });
    }
  }
  return out;
}

/** Steady-state estimate after two weeks of hourly observations at the given daily rates. */
function steadyEstimate(daily: number, relShare: number): GroupEstimate {
  let e = emptyEstimate();
  const now = Date.now();
  for (let h = 14 * 24; h > 0; h--) {
    const end = new Date(now - (h - 1) * 3_600_000);
    e = updateEstimate(e, { results: daily / 24, relevant: (daily / 24) * relShare, windowStart: new Date(end.getTime() - 3_600_000), windowEnd: end, saturated: false, at: end });
  }
  return e;
}

interface CheckV2 { usd: number; found: number; total: number; lostResults: number; saturated: number; brandSaturated: number; continuationPages: number; expansionUsd: number; commentsUsd: number }

/** One check of one platform at `interval` (and each search's own interval when it runs out of turn). */
function checkV2(id: PaidSourceId, ss: SearchV2[], interval: number, groupInterval: Map<string, number>, share: number): CheckV2 {
  const r: CheckV2 = { usd: 0, found: 0, total: 0, lostResults: 0, saturated: 0, brandSaturated: 0, continuationPages: 0, expansionUsd: 0, commentsUsd: 0 };
  let expansionPool = 0;
  for (const s of ss) {
    const prof = collectionProfile(id, s.stream.split("/")[1]!);
    const ep = STREAM_ENDPOINTS[s.stream]!;
    const price = prices[ep.pricingKey] ?? 0;
    const every = groupInterval.get(s.id) ?? interval * (s.rotation ? rotationTurns(s.rotation) : 1);
    const runsPerCheck = interval / every; // < 1 for rotating searches
    const window = every + CHECK_OVERLAP_MINUTES;
    const results = s.daily * (window / 1440);
    const fresh = s.daily * (every / 1440); // new results since the last run (overlap re-reads are duplicates)
    const est = steadyEstimate(s.daily, s.relShare);
    const cap = Math.min(prof.maxPagesPerJob, CAP_V2[s.stream]);
    let pages: number;
    let reach: number; // results this run can read
    if (s.stream === "news/articles") {
      pages = 1;
      reach = prof.perPage;
    } else if (prof.billing === "pages") {
      pages = pagesToRequest({ ratePerHour: upperRate(est.raw), windowMinutes: window, perPage: prof.perPage, maxPages: cap, billing: "pages", learning: false });
      reach = pages * prof.perPage;
      if (results > reach && prof.resume !== "range" && pages < cap) {
        const more = Math.min(cap, Math.ceil((results * 1.2) / prof.perPage));
        pages += more; // one escalation call re-bills its pages
        reach = more * prof.perPage;
      }
    } else {
      const fill = Math.max(1, Math.ceil(results / prof.perPage));
      pages = Math.min(cap, fill);
      reach = pages * prof.perPage;
    }
    // Continuations: range sources read the rest in follow-up jobs; page sources up to the provider's page limit.
    let contPages = 0;
    if (results > reach && prof.resume === "range") {
      contPages = Math.ceil((results - reach) / prof.perPage);
      reach = results;
    } else if (results > reach && prof.resume === "page" && prof.providerMaxPages !== null) {
      const extra = Math.min(prof.providerMaxPages, Math.ceil(results / prof.perPage)) - pages;
      contPages = Math.max(0, extra);
      reach = Math.min(results, prof.providerMaxPages * prof.perPage);
    }
    const readFresh = Math.min(fresh, reach);
    const lost = Math.max(0, fresh - readFresh);
    const ranked = !prof.sortNewest; // relevance-ranked: a sample, never complete
    const cost = price * (pages + contPages);
    r.usd += cost * runsPerCheck;
    if (s.stream === "reddit/comments") r.commentsUsd += cost * runsPerCheck;
    r.continuationPages += contPages * runsPerCheck;
    r.total += fresh * s.relShare * runsPerCheck;
    r.found += readFresh * s.relShare * (ranked ? 0.7 : 1) * runsPerCheck; // ranked search: assume 70% recall (unknown; shown as partial)
    r.lostResults += lost * runsPerCheck;
    if (lost > 0) {
      r.saturated += runsPerCheck;
      if (s.brand) r.brandSaturated += runsPerCheck;
    }
    expansionPool += readFresh * runsPerCheck;
  }
  const exp = EXPANSION[id];
  if (exp) r.expansionUsd = Math.min(expansionsPerRun(Math.round(share * 100)), Math.floor(expansionPool * 0.3)) * (prices[exp] ?? 0);
  r.usd += r.expansionUsd;
  return r;
}

function simulateV2(keywords: OptimizerKeyword[], plan: Plan, p: ProfileV2) {
  const platforms = PAID_SOURCES.map((id) => ({ id, ss: searchesV2(id, keywords, plan, p) })).filter((x) => x.ss.length > 0);
  const relDaily = Object.fromEntries(platforms.map((x) => [x.id, x.ss.reduce((t, s) => t + s.daily * s.relShare, 0) * 28]));
  const shares = importanceShares(relDaily);
  const decided = platforms.map((x) => {
    const groups: GroupModel[] = x.ss.map((s) => {
      const cap = planningCapacity(collectionProfile(x.id, s.stream.split("/")[1]!));
      return { id: s.id, estimate: steadyEstimate(s.daily, s.relShare), capacity: cap.capacity, resumable: cap.resumable, turns: s.rotation ? rotationTurns(s.rotation) : 1 };
    });
    const d = decidePlatformIntervalV2({
      now: new Date(), paid: true, planName: plan.name, groups, importanceShare: shares[x.id] ?? null, platformsMonitored: platforms.length,
      profile: null, confidence: "high", spikeRecent: false, auditMissed: 0, planMinMinutes: plan.floor, maxIntervalMinutes: 1440, boost: null, previous: null,
    });
    const rotations = x.ss.map((s) => s.rotation).filter((r): r is Rotation => Boolean(r));
    const t = applyKeywordTarget({ platformName: adapters[x.id].name, interval: d.interval, rotations, targetMinutes: plan.target, floorMinutes: plan.floor, planName: plan.name });
    return { ...x, groups, d, interval: t.interval, turns: Math.max(1, ...rotations.map((r) => rotationTurns(r))) };
  });
  const groupIntervals = (x: (typeof decided)[number], interval: number) => {
    const m = new Map<string, number>();
    for (const [k, s] of x.ss.entries()) {
      const safe = x.d.groups[k]?.safeMinutes ?? null;
      const base = interval * (s.rotation ? rotationTurns(s.rotation) : 1);
      m.set(s.id, s.rotation && safe !== null && safe < base ? Math.max(interval, plan.floor, snapDown(safe)) : base);
    }
    return m;
  };
  const costAt = (x: (typeof decided)[number], iv: number) => checkV2(x.id, x.ss, iv, groupIntervals(x, iv), shares[x.id] ?? 0).usd;
  const pacing = paceForBudgetSafely(decided.map((x) => ({
    platform: x.id, interval: x.interval, safeMinutes: x.d.safeMinutes, costPerCheckUsd: costAt(x, x.interval), costAt: (iv: number) => costAt(x, iv),
  })), plan.budget, MONTH);
  const detail = decided.map((x) => {
    const iv = pacing.intervals.get(x.id) ?? x.interval;
    const gi = groupIntervals(x, iv);
    const c = checkV2(x.id, x.ss, iv, gi, shares[x.id] ?? 0);
    const perMonth = MONTH / iv;
    const slowest = Math.max(...gi.values());
    return {
      platform: x.id, interval_h: iv / 60, slowest_keyword_h: slowest / 60, target_met: slowest <= plan.target,
      usd_month: c.usd * perMonth, found_month: c.found * perMonth, total_month: c.total * perMonth,
      lost_results_month: c.lostResults * perMonth, saturated_runs_month: c.saturated * perMonth, brand_saturated: c.brandSaturated > 0,
      continuation_pages_month: c.continuationPages * perMonth, expansion_usd: c.expansionUsd * perMonth, comments_usd: c.commentsUsd * perMonth,
      risk: assessRisk(iv, x.d.safeMinutes, plan.floor).risk,
    };
  });
  const usd = detail.reduce((t, d) => t + d.usd_month, 0);
  // Over budget: paid requests beyond the limit are refused (late in the period), so that share isn't found.
  const found = detail.reduce((t, d) => t + d.found_month, 0) * Math.min(1, plan.budget / Math.max(usd, 1e-9));
  const total = detail.reduce((t, d) => t + d.total_month, 0);
  const orPlatforms = new Set(["reddit", "x", "linkedin", "web", "news"]);
  return {
    usd, found, total, completeness: total > 0 ? found / total : 1, fits: pacing.fits, detail,
    misses: detail.filter((d) => !d.target_met).map((d) => `${d.platform} ${d.slowest_keyword_h.toFixed(0)}h`),
    risks: detail.filter((d) => d.risk === "at_risk" || d.risk === "unavoidable").map((d) => `${d.platform}:${d.risk}`),
    brandSaturated: detail.filter((d) => d.brand_saturated).map((d) => d.platform),
    lost: detail.reduce((t, d) => t + d.lost_results_month, 0),
    expansion: detail.reduce((t, d) => t + d.expansion_usd, 0),
    comments: detail.reduce((t, d) => t + d.comments_usd, 0),
    acceptable: pacing.fits && detail.filter((d) => orPlatforms.has(d.platform)).every((d) => d.target_met)
      && detail.every((d) => d.slowest_keyword_h * 60 <= plan.target * 2) && detail.every((d) => !d.brand_saturated),
  };
}

/** One-off historical backfill over `days`: what each search can reach, pages it costs, mentions it finds. */
function backfill(keywords: OptimizerKeyword[], plan: Plan, p: ProfileV2, days: number) {
  let usd = 0;
  let found = 0;
  let total = 0;
  for (const id of PAID_SOURCES) {
    for (const s of searchesV2(id, keywords, plan, p)) {
      const prof = collectionProfile(id, s.stream.split("/")[1]!);
      const price = prices[STREAM_ENDPOINTS[s.stream]!.pricingKey] ?? 0;
      const reachDays = prof.historyDays === null ? days : Math.min(days, prof.historyDays);
      const results = s.daily * days;
      let reachable = s.daily * reachDays;
      if (prof.resume === "none") reachable = Math.min(reachable, (prof.providerMaxPages ?? prof.maxPagesPerJob) * prof.perPage);
      if (prof.resume === "page" && prof.providerMaxPages !== null) reachable = Math.min(reachable, prof.providerMaxPages * prof.perPage);
      const pages = s.stream === "news/articles" ? 1 : Math.max(1, Math.ceil(reachable / prof.perPage));
      usd += price * pages;
      total += results * s.relShare;
      found += reachable * s.relShare * (prof.sortNewest ? 1 : 0.7);
    }
  }
  return { usd, found, total };
}

const rows: Array<Record<string, unknown>> = [];
const json: Record<string, unknown> = {};
if (process.argv.includes("--v1")) {
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
} else {
  for (const [label, keywords, planNames] of [["10 keywords", TEN, ["Pro", "Scale"]], ["40 keywords", FORTY, ["Scale"]]] as const) {
    for (const plan of PLANS.filter((p) => (planNames as readonly string[]).includes(p.name))) {
      for (const profile of PROFILES_V2) {
        const r = simulateV2(keywords as OptimizerKeyword[], plan, profile);
        const b30 = backfill(keywords as OptimizerKeyword[], plan, profile, 30);
        const b365 = backfill(keywords as OptimizerKeyword[], plan, profile, 365);
        const key = `${plan.name} $${plan.budget} · ${label} · ${profile.name}`;
        json[key] = { ...r, backfill30: b30, backfill365: b365, note: profile.note };
        rows.push({
          scenario: key, "cost/mo": `$${r.usd.toFixed(2)}${r.fits ? "" : " (over)"}`, "relevant found/mo": Math.round(r.found),
          complete: `${Math.round(r.completeness * 100)}%`, allowance: r.found > plan.allowance ? `over (${plan.allowance.toLocaleString("en-US")})` : `${Math.round((r.found / plan.allowance) * 100)}%`, "keyword misses": r.misses.join(", ") || "none",
          "overflow risk": r.risks.join(", ") || "none", "comments $": r.comments.toFixed(2), "expansion $": r.expansion.toFixed(2),
          "backfill 30d": `$${b30.usd.toFixed(2)} / ${Math.round(b30.found)}`, "backfill 1y": `$${b365.usd.toFixed(2)} / ${Math.round(b365.found)}`,
          ok: r.acceptable ? "yes" : "no",
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
  if (process.argv.includes("--v1")) {
    console.log("V1 (previous engine). Acceptable = paced spend ≤ budget, plan target met on OR platforms, every platform within 2× target, no brand search saturated.");
  } else {
    console.log("V2. cost/mo = paced paid spend (\"over\" = can't fit without overflow: requests beyond the limit are refused and shown as gaps).");
    console.log("relevant found/mo and complete = expected relevant paid-platform mentions read vs arriving (ranked searches assumed 70% recall; over budget, the refused share is not found).");
    console.log("allowance = found/mo as a share of the plan's monthly mention allowance (paid platforms only; free sources add more).");
    console.log("backfill = one-off cost / relevant mentions found for a 30-day and 1-year historical search (provider depth limits applied).");
    console.log("ok = fits the budget, plan target met on OR platforms, every platform within 2× target, no brand search overflowing.");
  }
  console.log("Estimates only: volumes and relevance shares are assumptions; prices from provider_pricing; first 50 requests/endpoint/month free (ignored).");
}
void ENDPOINTS;
