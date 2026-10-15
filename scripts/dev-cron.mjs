// Local stand-in for the production scheduler: calls POST /api/jobs/tick on
// an interval while `npm run dev` is running. In production, Supabase Cron
// does this (see ENVIRONMENT_SETUP.md §4).
//
//   npm run dev:cron              (every 120 s)
//   TICK_EVERY=30 npm run dev:cron
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const secret = process.env.JOBS_TICK_SECRET;
if (!secret) {
  console.error("JOBS_TICK_SECRET is not set (.env.local).");
  process.exit(1);
}
const base = process.env.TICK_URL ?? "http://localhost:3000";
const every = Math.max(15, Number(process.env.TICK_EVERY ?? 120)) * 1000;

async function tick() {
  const started = Date.now();
  try {
    const res = await fetch(`${base}/api/jobs/tick`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
    const body = await res.text();
    console.log(`${new Date().toISOString()} ${res.status} ${Date.now() - started}ms ${body.slice(0, 300)}`);
  } catch (e) {
    console.error(`${new Date().toISOString()} tick failed: ${e instanceof Error ? e.message : e}`);
  }
}

await tick();
setInterval(tick, every);
