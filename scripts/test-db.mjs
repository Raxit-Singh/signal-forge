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
