// Development scheduler. In production Supabase Cron calls POST /api/jobs/tick
// (ENVIRONMENT_SETUP.md §4); during `next dev` nothing would, so monitoring,
// historical search, spike detection and classification would only move when
// someone clicked something. The dev server ticks itself instead, through the
// same authenticated endpoint. Turn off with DEV_SCHEDULER=off.

const EVERY_MS = 120_000;
const FIRST_AFTER_MS = 15_000;

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "development") return;
  if (process.env.DEV_SCHEDULER === "off") return;
  const g = globalThis as { __signalforgeDevScheduler?: boolean };
  if (g.__signalforgeDevScheduler) return; // once per server process, across reloads
  const secret = process.env.JOBS_TICK_SECRET;
  if (!secret || secret.length < 32) {
    console.warn("[dev-scheduler] JOBS_TICK_SECRET is not set: automatic monitoring is not running.");
    return;
  }
  g.__signalforgeDevScheduler = true;
  const url = `http://localhost:${process.env.PORT ?? "3000"}/api/jobs/tick`;
  let running = false;
  const tick = async () => {
    if (running) return; // a tick works for up to ~50 s; never overlap
    running = true;
    try {
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
      if (!res.ok) console.warn(`[dev-scheduler] tick ${res.status}`);
    } catch (e) {
      console.warn(`[dev-scheduler] tick failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  console.log(`[dev-scheduler] running the job scheduler every ${EVERY_MS / 1000}s (DEV_SCHEDULER=off to disable)`);
  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), EVERY_MS);
  }, FIRST_AFTER_MS);
}
