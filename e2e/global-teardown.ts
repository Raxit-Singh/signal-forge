// Safety net after every run: deletes sf-e2e-*@example.com accounts created since the run
// started. Tests still delete their own accounts; this catches the ones a failure skipped,
// so leftover workspaces never keep searching (and spending) after the run.
import { deleteUser } from "./support";

const TEST_EMAIL = /^sf-e2e-[\w-]+@example\.com$/;

export default async function globalTeardown() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const since = process.env.E2E_RUN_STARTED_AT;
  if (!url || !key || !since) return;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const leftovers: string[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
    if (!res.ok) return;
    const users = ((await res.json()).users ?? []) as { id: string; email?: string; created_at: string }[];
    for (const u of users) if (TEST_EMAIL.test(u.email ?? "") && u.created_at >= since) leftovers.push(u.id);
    if (users.length < 200) break;
  }
  for (const id of leftovers) await deleteUser(id);
  if (leftovers.length) console.log(`e2e teardown: removed ${leftovers.length} leftover test account(s)`);
}
