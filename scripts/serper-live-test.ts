// Live test of the Serper web + news adapters (paid: 1 credit for web, 2 for news).
//
//   node scripts/serper-live-test.ts [--keyword "toing"] [--days 7]
//
// Prints results per adapter (after window filtering and normalization) and how
// many mention the keyword. No database writes.
import { existsSync } from "node:fs";
import { createSerperSearch } from "../src/lib/sources/serper/serper.ts";
import type { SourceContext } from "../src/lib/sources/types.ts";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const KEY = process.env.SERPER_API_KEY;
if (!KEY) { console.error("SERPER_API_KEY is not set in .env.local"); process.exit(1); }
const arg = (n: string, d: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : d);
const keyword = arg("--keyword", "toing");
const days = Number(arg("--days", "7"));
const ctx: SourceContext = {
  async request() { throw new Error("paid only"); },
  async paidRequest(req) {
    const response = await fetch(req.url, { method: req.method, body: req.body, headers: req.headers, signal: req.signal });
    return { response, ledgerId: null, settle: async () => {} };
  },
  async cooldown() {},
  now: () => new Date(),
};
const s = createSerperSearch(KEY);
const window = { since: new Date(Date.now() - days * 86_400_000), until: new Date() };
const re = new RegExp(keyword.replace(/\s+/g, "\\s*"), "i");
for (const p of ["web", "news"] as const) {
  try {
    const r = await s[p]({ terms: [keyword], window, maxPages: 1 }, ctx);
    console.log(`${p.padEnd(5)} ${r.items.length} results · ${r.items.filter((i) => re.test(i.matchText)).length} mention "${keyword}"`);
    for (const i of r.items.slice(0, 3)) console.log(`      ${i.publishedAt.toISOString().slice(0, 10)}  ${(i.title ?? "").slice(0, 80)}`);
  } catch (e) {
    console.log(`${p.padEnd(5)} error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
