// Authorized, budget-capped live validation of the API Direct connectors.
// PAID: every answered request is billed (including zero results). Never run in CI.
//
//   node scripts/apidirect-live-test.ts --confirm --max-usd 0.05 --provider-limit-confirmed [--session 2026-10-16] [--plan]
//
// Safety:
//   * The cap is CUMULATIVE for the session: every request (retries included) is
//     reserved in api_cost_ledger (purpose 'live_test', fingerprint 'live-test:<session>')
//     before it is sent, and refused if the session's recorded spend + this request's
//     worst-case estimate would exceed --max-usd. Re-running the script never resets it.
//   * Estimates use the provider_pricing registry and the documented billing rules
//     (zero results are billed; multi-page endpoints bill per page requested).
//     API Direct's free monthly requests are ignored, so the estimate is an upper bound.
//   * Refuses unless: API_DIRECT_API_KEY is set (never printed), paid production
//     monitoring is off (PAID_SOURCES_ENABLED != true), the internal ledger is
//     reachable, and the operator passes --provider-limit-confirmed after checking
//     the provider's own daily/monthly spending limits in its dashboard (API Direct
//     has no API to read them).
//   * Writes nothing to mentions. Raw responses go to .apidirect-live/ (gitignored).
//   * --plan prints the plan and worst-case cost without sending anything.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createApiDirectAdapters } from "../src/lib/sources/apidirect/adapters.ts";
import { ENDPOINTS, type EndpointSpec } from "../src/lib/sources/apidirect/endpoints.ts";
import type { BillingOutcome, CandidateMention, PaidSourceId, SearchRequest, SourceContext } from "../src/lib/sources/types.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (msg: string): never => {
  console.error(`REFUSED: ${msg}`);
  process.exit(1);
};

const planOnly = flag("plan");
const maxUsd = Number(opt("max-usd"));
const session = opt("session") ?? new Date().toISOString().slice(0, 10);
if (process.env.CI) fail("paid API tests never run in CI.");
if (!(maxUsd > 0) || maxUsd > 1) fail("pass --max-usd <amount> (0 < amount <= 1).");
if (!planOnly && !flag("confirm")) fail("pass --confirm to authorize spending.");
const key = process.env.API_DIRECT_API_KEY;
if (!key) fail("API_DIRECT_API_KEY is not set.");
if (process.env.PAID_SOURCES_ENABLED === "true") fail("PAID_SOURCES_ENABLED=true: paid production monitoring must be off during the live test.");
if (!planOnly && !flag("provider-limit-confirmed")) {
  fail("confirm API Direct's own daily/monthly spending limits in its billing dashboard, then pass --provider-limit-confirmed.");
}

// Micro-dollars: integer arithmetic for the cap.
const µ = (usd: number) => Math.round(usd * 1_000_000);
const usd = (micro: number) => (micro / 1_000_000).toFixed(4);
const capµ = µ(maxUsd);
const FP = `live-test:${session}`;

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init, headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "content-type": "application/json", Prefer: "return=representation" },
  });
  if (!r.ok) throw new Error(`ledger ${path.split("?")[0]} → ${r.status}`);
  return (await r.json()) as T;
}

const prices = new Map<string, number>();
try {
  for (const p of await db<Array<{ pricing_key: string; price_usd: number }>>("provider_pricing?select=pricing_key,price_usd,effective_from&order=effective_from.desc")) {
    if (!prices.has(p.pricing_key)) prices.set(p.pricing_key, Number(p.price_usd));
  }
} catch (e) {
  fail(`internal cost tracking unavailable (${e instanceof Error ? e.message : e}).`);
}
const sessionSpentµ = async () => {
  const rows = await db<Array<{ estimated_usd: number; charged_usd: number | null; status: string }>>(
    `api_cost_ledger?select=estimated_usd,charged_usd,status&purpose=eq.live_test&query_fingerprint=eq.${encodeURIComponent(FP)}`);
  // Unsettled/unknown rows count at their estimate (a crashed call may still have been billed).
  return rows.reduce((t, r) => t + (r.status === "released" ? 0 : r.status === "settled" ? µ(Number(r.charged_usd ?? 0)) : µ(Number(r.estimated_usd))), 0);
};
const globalBudget = await db<Array<{ monthly_limit_usd: number }>>("api_budgets?select=monthly_limit_usd&scope=eq.global");

// ---------------------------------------------------------------------------
// Plan (priority order). OR-capable platforms get the combined test query.
// ---------------------------------------------------------------------------
const OR_QUERY = '"starlink" OR "wisprflow"';
const WEEK = { since: new Date(Date.now() - 7 * 86_400_000), until: new Date() };
interface Step { name: string; platform: PaidSourceId; spec: EndpointSpec; units: number; req: SearchRequest }
const steps: Step[] = [
  { name: "1 Reddit posts (OR)", platform: "reddit", spec: ENDPOINTS.redditPosts, units: 1, req: { terms: ["starlink", "wisprflow"], query: OR_QUERY, window: WEEK, maxPages: 1, stream: "posts" } },
  { name: "2 Reddit comments (2 pages)", platform: "reddit", spec: ENDPOINTS.redditComments, units: 2, req: { terms: ["starlink"], query: "starlink", window: WEEK, maxPages: 2, stream: "comments" } },
  { name: "3 X posts (OR)", platform: "x", spec: ENDPOINTS.xPosts, units: 1, req: { terms: ["starlink", "wisprflow"], query: OR_QUERY, window: WEEK, maxPages: 1 } },
  { name: "4 LinkedIn posts (OR)", platform: "linkedin", spec: ENDPOINTS.linkedinPosts, units: 1, req: { terms: ["starlink", "wisprflow"], query: OR_QUERY, window: WEEK, maxPages: 1 } },
  { name: "5 TikTok videos", platform: "tiktok", spec: ENDPOINTS.tiktokVideos, units: 1, req: { terms: ["starlink"], query: "starlink", window: WEEK, maxPages: 1 } },
  { name: "6 Instagram posts", platform: "instagram", spec: ENDPOINTS.instagramPosts, units: 1, req: { terms: ["starlink"], query: "starlink", window: WEEK, maxPages: 1 } },
  { name: "7 Facebook posts", platform: "facebook", spec: ENDPOINTS.facebookPosts, units: 1, req: { terms: ["starlink"], query: "starlink", window: WEEK, maxPages: 1 } },
  { name: "8 Substack posts", platform: "substack", spec: ENDPOINTS.substackPosts, units: 1, req: { terms: ["starlink"], query: "starlink", window: WEEK, maxPages: 1, stream: "posts" } },
  { name: "9 Google web (OR)", platform: "web", spec: ENDPOINTS.webSearch, units: 1, req: { terms: ["starlink", "wisprflow"], query: OR_QUERY, window: WEEK, maxPages: 1, stream: "results" } },
  { name: "10 Google News (OR)", platform: "news", spec: ENDPOINTS.newsArticles, units: 1, req: { terms: ["starlink", "wisprflow"], query: OR_QUERY, window: WEEK, maxPages: 1, stream: "articles" } },
  { name: "11 Trustpilot reviews", platform: "trustpilot", spec: ENDPOINTS.trustpilotReviews, units: 1, req: { terms: [], window: { since: new Date(Date.now() - 30 * 86_400_000), until: new Date() }, maxPages: 1, stream: "reviews", target: { websiteDomain: "starlink.com" } } },
  // Boolean comparison (only if budget remains): the rarer term alone, to see whether the OR query missed it.
  { name: "12 Reddit posts (wisprflow alone)", platform: "reddit", spec: ENDPOINTS.redditPosts, units: 1, req: { terms: ["wisprflow"], query: "wisprflow", window: WEEK, maxPages: 1, stream: "posts" } },
];
const estµ = (s: Step) => µ((prices.get(s.spec.pricingKey) ?? NaN) * s.units);
for (const s of steps) if (!Number.isFinite(estµ(s))) fail(`no price for ${s.spec.pricingKey}`);

const before = await sessionSpentµ();
console.log(`Session ${session}: cap $${maxUsd}; already recorded $${usd(before)}; paid production monitoring off; global paid budget row: ${globalBudget.length ? "present" : "none (production paid calls impossible)"}.`);
let projected = before;
console.table(steps.map((s) => {
  const fits = projected + estµ(s) <= capµ;
  if (fits) projected += estµ(s);
  return { step: s.name, endpoint: s.spec.path, units: s.units, worst_case_usd: usd(estµ(s)), within_cap: fits ? "yes" : "NO (would stop)" };
}));
console.log(`Worst-case total if run in order, stopping before the cap: $${usd(projected - before)} (session total $${usd(projected)}).`);
if (planOnly) process.exit(0);

// ---------------------------------------------------------------------------
// Paid context: reserve in the ledger → request → settle. Every attempt checks the cap.
// ---------------------------------------------------------------------------
const outDir = ".apidirect-live";
mkdirSync(`${outDir}/raw`, { recursive: true });
const calls: Array<Record<string, unknown>> = [];
let raw: unknown = null;
let current = "";
const ctx: SourceContext = {
  async request() {
    throw new Error("free requests are not part of this test");
  },
  async paidRequest(req) {
    const price = prices.get(req.billing.pricingKey)!;
    const est = µ(price * req.billing.units);
    const spent = await sessionSpentµ();
    if (spent + est > capµ) throw new Error(`BUDGET STOP: ${req.billing.pricingKey} (~$${usd(est)}) would take the session to $${usd(spent + est)} > $${maxUsd}`);
    const spec = Object.values(ENDPOINTS).find((e) => e.pricingKey === req.billing.pricingKey)!;
    const [row] = await db<Array<{ id: string }>>("api_cost_ledger", {
      method: "POST",
      body: JSON.stringify({
        provider: "apidirect", platform: spec.platform, endpoint: req.endpoint, pricing_key: req.billing.pricingKey, purpose: "live_test",
        units_requested: req.billing.units, unit_price_usd: price, estimated_usd: price * req.billing.units, status: "reserved", query_fingerprint: FP,
      }),
    });
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      await db(`api_cost_ledger?id=eq.${row!.id}`, { method: "PATCH", body: JSON.stringify({ status: "unknown", error_code: "network" }) });
      throw e;
    }
    raw = await response.clone().json().catch(() => null);
    const entry: Record<string, unknown> = { step: current, endpoint: req.endpoint, http: response.status, units: req.billing.units, est_usd: usd(est), ledger: row!.id };
    calls.push(entry);
    return {
      response,
      ledgerId: row!.id,
      settle: async (o: BillingOutcome) => {
        const charged = price * o.billedUnits;
        Object.assign(entry, { billed_units: o.billedUnits, charged_usd: usd(µ(charged)), results: o.results, code: o.errorCode ?? null, ms: Date.now() - started });
        await db(`api_cost_ledger?id=eq.${row!.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "settled", billed_units: o.billedUnits, charged_usd: charged, http_status: response.status,
            error_code: o.errorCode ?? null, results_returned: o.results ?? null, duration_ms: Date.now() - started, settled_at: new Date().toISOString(),
          }),
        });
      },
    };
  },
  async cooldown() {},
  now: () => new Date(),
};

// ---------------------------------------------------------------------------
// Run in priority order; stop before the cap.
// ---------------------------------------------------------------------------
const adapters = createApiDirectAdapters(key);
const report: Record<string, unknown> = { session, cap_usd: maxUsd, started_at: new Date().toISOString(), steps: {} as Record<string, unknown> };
const notTested: string[] = [];
let stopped = false;
for (const s of steps) {
  if (stopped) {
    notTested.push(s.name);
    continue;
  }
  if ((await sessionSpentµ()) + estµ(s) > capµ) {
    console.log(`${s.name}: not run — its worst case ($${usd(estµ(s))}) would exceed the remaining budget.`);
    notTested.push(s.name);
    // Endpoints are prioritized: stop at the first one that doesn't fit (the Boolean comparison is optional).
    if (!s.name.startsWith("12")) stopped = true;
    continue;
  }
  current = s.name;
  raw = null;
  try {
    const r = await adapters[s.platform].searchMentions(s.req, ctx);
    writeFileSync(`${outDir}/raw/${s.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`, JSON.stringify(raw, null, 2));
    (report.steps as Record<string, unknown>)[s.name] = analyse(s, r.items, raw);
    console.log(`${s.name}: ${r.items.length} normalized item(s)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (raw) writeFileSync(`${outDir}/raw/${s.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`, JSON.stringify(raw, null, 2));
    (report.steps as Record<string, unknown>)[s.name] = { error: msg, raw_keys: topKeys(raw) };
    console.log(`${s.name}: ${msg}`);
    if (msg.startsWith("BUDGET STOP")) {
      stopped = true;
      notTested.push(s.name);
    }
  }
}
const after = await sessionSpentµ();
report.calls = calls;
report.not_tested = notTested;
report.session_spent_estimated_usd = usd(after);
report.remaining_usd = usd(capµ - after);
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
console.table(calls);
console.log(`Not tested: ${notTested.join(", ") || "none"}`);
console.log(`Session spend by documented billing rules: $${usd(after)} of $${maxUsd} (remaining $${usd(capµ - after)}). Provider-confirmed charges: check the API Direct dashboard (50 free requests per endpoint per month may make the real charge $0).`);
console.log(`Report: ${outDir}/report.json (raw responses in ${outDir}/raw/, gitignored).`);

// ---------------------------------------------------------------------------
// Analysis helpers (field presence, URLs, timestamps, duplicates, OR terms)
// ---------------------------------------------------------------------------
function topKeys(body: unknown): string[] {
  return body && typeof body === "object" ? Object.keys(body as object) : [];
}

function list(body: unknown, field: string): Array<Record<string, unknown>> {
  const v = body && typeof body === "object" ? (body as Record<string, unknown>)[field] : null;
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

function analyse(s: Step, items: CandidateMention[], body: unknown) {
  const rawItems = list(body, s.spec.listField);
  const keys = new Map<string, number>();
  for (const it of rawItems) for (const k of Object.keys(it)) keys.set(k, (keys.get(k) ?? 0) + 1);
  const urls = items.map((i) => i.sourceUrl);
  const validUrls = urls.filter((u) => /^https:\/\/[^\s]+$/.test(u)).length;
  const dates = items.map((i) => i.publishedAt.getTime()).filter(Number.isFinite);
  const ids = items.map((i) => i.externalId);
  const out: Record<string, unknown> = {
    returned: rawItems.length,
    normalized: items.length,
    raw_top_level_keys: topKeys(body),
    raw_item_fields: Object.fromEntries(keys),
    https_urls: `${validUrls}/${items.length}`,
    distinct_urls: new Set(urls).size,
    duplicate_ids: ids.length - new Set(ids).size,
    newest: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    oldest: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
    estimated_dates: items.filter((i) => i.publishedAtEstimated).length,
    sample: items.slice(0, 3).map((i) => ({ url: i.sourceUrl, published: i.publishedAt.toISOString(), type: i.mentionType ?? "post", link: i.linkTarget ?? "item", community: i.community ?? null })),
  };
  const text = (i: CandidateMention) => i.matchText.toLowerCase();
  if (s.req.terms.length > 1) {
    out.or_terms = Object.fromEntries(s.req.terms.map((t) => [t, items.filter((i) => text(i).includes(t.toLowerCase())).length]));
    out.or_neither_term = items.filter((i) => s.req.terms.every((t) => !text(i).includes(t.toLowerCase()))).length;
  }
  if (s.platform === "reddit" && s.req.stream === "comments") {
    const term = s.req.terms[0]!.toLowerCase();
    out.comment_checks = {
      with_comment_id_field: rawItems.filter((r) => "id" in r || "comment_id" in r).length,
      with_parent_post_id_field: rawItems.filter((r) => "post_id" in r || "parent_id" in r || "link_id" in r).length,
      with_subreddit: rawItems.filter((r) => typeof r.subreddit === "string" && r.subreddit).length,
      with_timestamp: rawItems.filter((r) => r.date || r.created_utc || r.timestamp).length,
      url_is_comment_permalink: rawItems.filter((r) => typeof r.url === "string" && /\/comments\/[a-z0-9]+\/[^/]*\/[a-z0-9]+\/?$/i.test(r.url)).length,
      comment_contains_term: items.filter((i) => (i.content ?? "").toLowerCase().includes(term)).length,
      parent_title_lacks_term: rawItems.filter((r) => typeof r.title === "string" && !r.title.toLowerCase().includes(term)
        && JSON.stringify(r).toLowerCase().includes(term)).length,
      duplicate_raw_rows: rawItems.length - new Set(rawItems.map((r) => JSON.stringify(r))).size,
    };
  }
  if (s.platform === "x") {
    out.x_kinds = {
      replies: rawItems.filter((r) => r.is_reply === true).length,
      quotes: rawItems.filter((r) => r.is_quote === true).length,
      top_level: rawItems.filter((r) => r.is_reply !== true && r.is_quote !== true).length,
      status_urls: urls.filter((u) => /^https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+/.test(u)).length,
      normalized_types: Object.fromEntries([...new Set(items.map((i) => i.mentionType ?? "post"))].map((t) => [t, items.filter((i) => (i.mentionType ?? "post") === t).length])),
    };
  }
  return out;
}
