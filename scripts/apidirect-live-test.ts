// Authorized, budget-capped live validation of the API Direct connectors.
// PAID: every answered request is billed (including zero results). Never run in CI.
//
//   node scripts/apidirect-live-test.ts --confirm --max-usd 0.05 [--only reddit,x] [--query "Excalidraw"]
//
// Requires API_DIRECT_API_KEY plus NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY (prices are read from
// the provider_pricing registry, the single source of truth). Nothing is written to the database.
// Stops before any request that would push estimated spend over --max-usd.
import { existsSync } from "node:fs";
import { createApiDirectAdapters } from "../src/lib/sources/apidirect/adapters.ts";
import type { BillingOutcome, SourceContext } from "../src/lib/sources/types.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (process.env.CI) {
  console.error("Refusing to run paid API tests in CI.");
  process.exit(1);
}
const key = process.env.API_DIRECT_API_KEY;
const maxUsd = Number(opt("max-usd"));
if (!flag("confirm") || !(maxUsd > 0) || maxUsd > 1) {
  console.error("Paid test. Pass --confirm and --max-usd <0 < amount <= 1> to authorize spending.");
  process.exit(1);
}
if (!key) {
  console.error("API_DIRECT_API_KEY is not set.");
  process.exit(1);
}

const sb = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const priceRes = await fetch(`${sb}/rest/v1/provider_pricing?select=pricing_key,unit,price_usd,effective_from&order=effective_from.desc`, {
  headers: { apikey: secret, Authorization: `Bearer ${secret}` },
});
const prices = new Map<string, number>();
for (const p of (await priceRes.json()) as Array<{ pricing_key: string; price_usd: number }>) {
  if (!prices.has(p.pricing_key)) prices.set(p.pricing_key, Number(p.price_usd));
}

let spent = 0;
const log: Array<Record<string, unknown>> = [];
const ctx: SourceContext = {
  async request() {
    throw new Error("free requests are not part of this test");
  },
  async paidRequest(req) {
    const price = prices.get(req.billing.pricingKey);
    if (price === undefined) throw new Error(`No price for ${req.billing.pricingKey}`);
    const est = price * req.billing.units;
    if (spent + est > maxUsd) throw new Error(`Budget stop: ${req.billing.pricingKey} (~$${est.toFixed(4)}) would exceed $${maxUsd}`);
    spent += est; // reserved at estimate until settled
    const started = Date.now();
    const response = await fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(30_000) });
    const entry: Record<string, unknown> = { endpoint: req.endpoint, status: response.status, units: req.billing.units, estUsd: est };
    log.push(entry);
    return {
      response,
      ledgerId: `live-${log.length}`,
      settle: async (o: BillingOutcome) => {
        spent += price * o.billedUnits - est;
        Object.assign(entry, { billedUnits: o.billedUnits, chargedUsd: price * o.billedUnits, results: o.results, code: o.errorCode, ms: Date.now() - started });
      },
    };
  },
  async cooldown() {},
  now: () => new Date(),
};

const adapters = createApiDirectAdapters(key);
const only = (opt("only") ?? "reddit,x").split(",");
const query = opt("query") ?? "Excalidraw";
const window = { since: new Date(Date.now() - 2 * 86_400_000), until: new Date() };
const plan: Array<[string, () => Promise<{ items: unknown[] }>]> = [];
if (only.includes("reddit")) {
  plan.push(["reddit posts", () => adapters.reddit.searchMentions({ terms: [query], query, window, maxPages: 1, stream: "posts" }, ctx)]);
  plan.push(["reddit comments", () => adapters.reddit.searchMentions({ terms: [query], query, window, maxPages: 1, stream: "comments" }, ctx)]);
}
if (only.includes("x")) plan.push(["x posts", () => adapters.x.searchMentions({ terms: [query], query, window, maxPages: 1 }, ctx)]);

for (const [name, run] of plan) {
  try {
    const r = await run();
    console.log(`${name}: ${r.items.length} normalized item(s)`);
    for (const it of r.items.slice(0, 3) as Array<{ sourceUrl: string; publishedAt: Date; mentionType?: string; linkTarget?: string }>) {
      console.log(`   ${it.publishedAt.toISOString()} ${it.mentionType ?? "post"} ${it.linkTarget ?? "item"} ${it.sourceUrl}`);
    }
  } catch (e) {
    console.log(`${name}: ${e instanceof Error ? e.message : e}`);
  }
}
console.table(log);
console.log(`Estimated spend: $${spent.toFixed(4)} (cap $${maxUsd}). API Direct's free tier (50 requests/endpoint/month) may make the real charge $0; check the dashboard.`);
