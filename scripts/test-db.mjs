// Runs all migrations + database tests against a throwaway local PostgreSQL
// cluster. Uses Postgres binaries from the `embedded-postgres` dev dependency
// (same major version as Supabase), so no Docker, Homebrew or Supabase CLI is
// needed. Set PGBIN to use a system installation instead.
//
//   npm run test:db          (VERBOSE=1 to print every passing assertion)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
async function binDir() {
  if (process.env.PGBIN) return process.env.PGBIN;
  const { initdb } = await import(`@embedded-postgres/${process.platform}-${process.arch}`);
  return dirname(initdb);
}

const BIN = await binDir();
const data = mkdtempSync(join(tmpdir(), "signalforge-db-"));
const port = Number(process.env.PGPORT_TEST ?? 54329);
const run = (cmd, args) => execFileSync(join(BIN, cmd), args, { stdio: "ignore" });

run("initdb", ["-D", join(data, "db"), "-U", "postgres", "--auth=trust"]);
run("pg_ctl", ["-D", join(data, "db"), "-o", `-p ${port} -k ${data} -c listen_addresses=localhost`, "-l", join(data, "log"), "-w", "start"]);

const client = new pg.Client({ host: "localhost", port, user: "postgres", database: "postgres" });
let passed = 0;
const failures = [];
client.on("notice", ({ message }) => {
  if (message.startsWith("FAIL")) failures.push(message);
  else if (message.startsWith("ok")) passed++;
  if (process.env.VERBOSE || message.startsWith("FAIL")) console.log(message);
});

function check(cond, name) {
  if (cond) passed++;
  else failures.push(`FAIL - ${name}`);
  if (process.env.VERBOSE || !cond) console.log(`${cond ? "ok" : "FAIL"} - ${name}`);
}

/**
 * Two real connections ingest for the same workspace at once: the usage-period row
 * lock must serialize them so the mention allowance is never exceeded.
 */
async function concurrentIngestion() {
  console.log("→ concurrent ingestion (two connections)");
  const ws = "00000000-0000-0000-0000-0000000000c1";
  await client.query(`
    insert into public.plans (id, name, max_products, monthly_mention_limit, history_days, monitoring_interval_minutes, is_public)
    values ('t_conc', 'Concurrency', 5, 6, 30, 60, false);
    insert into public.workspaces (id, name, slug) values ('${ws}', 'Concurrency', 'concurrency-test');
    insert into public.subscriptions (workspace_id, plan_id) values ('${ws}', 't_conc');
    insert into public.products (id, workspace_id, name) values ('00000000-0000-0000-0000-0000000000c2', '${ws}', 'ConcurrentApp');`);
  const items = (prefix) => JSON.stringify(Array.from({ length: 4 }, (_, i) => ({
    external_id: `${prefix}${i}`, source_url: `https://news.ycombinator.com/item?id=${prefix}${i}`,
    published_at: "2026-10-05T00:00:00Z", relevance_status: "relevant",
  })));
  const ingest = "select public.svc_ingest_mentions('00000000-0000-0000-0000-0000000000c2', 'hackernews', $1::jsonb) as r";
  const a = new pg.Client({ host: "localhost", port, user: "postgres", database: "postgres" });
  const b = new pg.Client({ host: "localhost", port, user: "postgres", database: "postgres" });
  await Promise.all([a.connect(), b.connect()]);
  try {
    await a.query("begin");
    const ra = (await a.query(ingest, [items("ca")])).rows[0].r;
    // B starts while A still holds the period lock; it must wait, then see A's consumption.
    const pending = b.query(ingest, [items("cb")]);
    await new Promise((r) => setTimeout(r, 300));
    await a.query("commit");
    const rb = (await pending).rows[0].r;
    const { rows: [u] } = await client.query(`select mentions_consumed, mentions_held from public.mention_usage_periods where workspace_id = '${ws}'`);
    const { rows: [m] } = await client.query(`select count(*)::int as n, count(billed_period_start)::int as billed from public.mentions where workspace_id = '${ws}'`);
    check(ra.billable === 4 && rb.billable === 2 && rb.held === 2, "concurrent ingestion: the second worker waits and bills only the remaining allowance");
    check(u.mentions_consumed === 6 && m.billed === 6 && m.n === 6 && u.mentions_held === 2, "concurrent ingestion: allowance (6) never exceeded; the rest is held");
  } finally {
    await Promise.all([a.end(), b.end()]);
  }
}

let fatal = null;
try {
  await client.connect();
  const migrations = readdirSync(join(ROOT, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(ROOT, "supabase/migrations", f));
  const files = [join(ROOT, "supabase/tests/harness.sql"), ...migrations, join(ROOT, "supabase/tests/rls_test.sql")];
  for (const file of files) {
    console.log(`→ ${file.slice(ROOT.length + 1)}`);
    // Strip psql meta-commands so the files also run under plain psql.
    await client.query(readFileSync(file, "utf8").replace(/^\\set .*$/gm, ""));
  }
  await concurrentIngestion();
} catch (e) {
  fatal = e;
} finally {
  await client.end().catch(() => {});
  try {
    run("pg_ctl", ["-D", join(data, "db"), "-m", "immediate", "stop"]);
  } catch {}
  rmSync(data, { recursive: true, force: true });
}

if (fatal) {
  console.error(`ERROR: ${fatal.message}${fatal.where ? `\n${fatal.where}` : ""}`);
  process.exit(1);
}
console.log(`\n# pass ${passed}\n# fail ${failures.length}`);
process.exit(failures.length ? 1 : 0);
