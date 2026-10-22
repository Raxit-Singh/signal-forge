// Live test of the TikHub search adapters (paid: ~$0.001–0.002 per call).
//
//   node scripts/tikhub-live-test.ts [--keyword "toing"] [--days 7] [--pages 2]
//
// Runs X, TikTok and Instagram search through the real adapters (cursor paging,
// window filtering, normalization) and prints per platform: calls, cost, items
// in the window, items mentioning the keyword. No database writes; the calls are
// not recorded in the app's ledger (TikHub's own balance is the record).
import { existsSync } from "node:fs";
import { createTikhubSearch } from "../src/lib/sources/tikhub/adapters.ts";
import type { BillingIntent, SourceContext, SourceRequest } from "../src/lib/sources/types.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const KEY = process.env.TIKHUB_API_KEY;
if (!KEY) { console.error("TIKHUB_API_KEY is not set in .env.local"); process.exit(1); }
const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : d);
const keyword = arg("--keyword", "toing");
const days = Number(arg("--days", "7"));
const pages = Number(arg("--pages", "2"));
const PRICE: Record<string, number> = { "tikhub_x.search": 0.001, "tikhub_tiktok.search": 0.001, "tikhub_instagram.reels": 0.002 };

let spent = 0;
let calls = 0;
const ctx: SourceContext = {
  async request() { throw new Error("paid only"); },
  async paidRequest(req: SourceRequest & { billing: BillingIntent }) {
    calls++;
    const response = await fetch(req.url, { headers: req.headers, signal: req.signal });
    return {
      response, ledgerId: null,
      settle: async (o) => { spent += (PRICE[req.billing.pricingKey] ?? 0) * o.billedUnits; },
    };
  },
  async cooldown() {},
  now: () => new Date(),
};

const search = createTikhubSearch(KEY);
const window = { since: new Date(Date.now() - days * 86_400_000), until: new Date() };
const re = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"), "i");
const rows = [];
for (const p of ["x", "tiktok", "instagram"] as const) {
  const before = { spent, calls };
  const t = Date.now();
  try {
    const r = await search[p]!({ terms: [keyword], window, maxPages: pages }, ctx);
    rows.push({ platform: p, calls: calls - before.calls, usd: +(spent - before.spent).toFixed(4), inWindow: r.items.length,
      mentionKeyword: r.items.filter((i) => re.test(i.matchText)).length, complete: r.complete, secs: +((Date.now() - t) / 1000).toFixed(1) });
  } catch (e) {
    rows.push({ platform: p, calls: calls - before.calls, usd: +(spent - before.spent).toFixed(4), error: e instanceof Error ? e.message.slice(0, 80) : String(e) });
  }
}
console.log(`"${keyword}", last ${days} days, up to ${pages} pages`);
console.table(rows);
console.log(`Total: ${calls} calls, $${spent.toFixed(4)}`);
