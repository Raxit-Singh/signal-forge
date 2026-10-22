// TikHub live probe (paid: ~$0.001–0.002 per call, ~8 calls ≈ $0.01).
//
//   node scripts/tikhub-probe.ts [--keyword "toing"]
//
// Calls each search endpoint SignalForge would use once, prints status, item
// counts and timing, and saves the raw JSON to .tikhub-live/ (git-ignored) so
// response shapes can be read before normalizers are written. Reads
// TIKHUB_API_KEY from .env.local; never prints it.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const KEY = process.env.TIKHUB_API_KEY;
if (!KEY) { console.error("TIKHUB_API_KEY is not set in .env.local"); process.exit(1); }
const args = process.argv.slice(2);
const kw = args.includes("--keyword") ? args[args.indexOf("--keyword") + 1]! : "toing";
const BASE = "https://api.tikhub.io";
mkdirSync(".tikhub-live", { recursive: true });

async function call(name: string, path: string, params: Record<string, string>) {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  const t = Date.now();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" } });
  const text = await res.text();
  writeFileSync(`.tikhub-live/${name}.json`, text);
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  const b = body as { code?: number; message?: string; data?: unknown } | null;
  console.log(`${name.padEnd(22)} HTTP ${res.status} · code ${b?.code ?? "?"} · ${Date.now() - t} ms · ${text.length} bytes${b?.message && res.status !== 200 ? ` · ${String(b.message).slice(0, 120)}` : ""}`);
}

// Account info is free and confirms the key works.
await call("user_info", "/api/v1/tikhub/user/get_user_info", {});
// Exact per-endpoint prices (free to read).
await call("endpoint_prices", "/api/v1/tikhub/user/get_all_endpoints_info", {});
await call("x_search_latest", "/api/v1/twitter/web/fetch_search_timeline", { keyword: kw, search_type: "Latest" });
await call("tiktok_video_search", "/api/v1/tiktok/app/v3/fetch_video_search_result", { keyword: kw, count: "20", sort_type: "1", publish_time: "7", region: "US" });
await call("reddit_post_search", "/api/v1/reddit/app/fetch_dynamic_search", { query: kw, search_type: "post", sort: "NEW", time_range: "week", need_format: "true" });
await call("reddit_comment_search", "/api/v1/reddit/app/fetch_dynamic_search", { query: kw, search_type: "comment", sort: "NEW", need_format: "true" });
await call("instagram_search", "/api/v1/instagram/v2/general_search", { keyword: kw });
await call("instagram_reels", "/api/v1/instagram/v2/search_reels", { keyword: kw });
await call("threads_recent", "/api/v1/threads/web/search_recent", { query: kw });
await call("user_info_after", "/api/v1/tikhub/user/get_user_info", {});
console.log("\nRaw responses saved in .tikhub-live/ (git-ignored).");
