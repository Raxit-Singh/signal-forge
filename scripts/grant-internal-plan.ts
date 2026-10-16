// Internal plan entitlement for SignalForge-owned test workspaces (service role).
// Not a subscription: nothing is billed and `subscriptions` is never touched.
//
//   node scripts/grant-internal-plan.ts --workspace <uuid> --plan pro [--days 90] [--note "..."]     # dry run
//   node scripts/grant-internal-plan.ts --workspace <uuid> --plan pro --apply
//   node scripts/grant-internal-plan.ts --workspace <uuid> --revoke --apply
//
// Refuses workspaces with a payment-provider subscription (real customers).
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
const ws = opt("workspace");
const plan = opt("plan");
const revoke = args.includes("--revoke");
const apply = args.includes("--apply");
const days = opt("days") ? Number(opt("days")) : null;
if (!ws || !/^[0-9a-f-]{36}$/i.test(ws) || (!revoke && !plan)) {
  console.error("Usage: node scripts/grant-internal-plan.ts --workspace <uuid> (--plan <id> [--days N] | --revoke) [--apply]");
  process.exit(1);
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init, headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "content-type": "application/json", Prefer: "return=representation,resolution=merge-duplicates" },
  });
  if (!r.ok) throw new Error(`${path.split("?")[0]} → ${r.status} ${await r.text()}`);
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}

const [w] = await req<Array<{ id: string; name: string }>>(`workspaces?select=id,name&id=eq.${ws}`);
if (!w) throw new Error("Workspace not found");
const [sub] = await req<Array<{ plan_id: string; status: string; provider: string }>>(`subscriptions?select=plan_id,status,provider&workspace_id=eq.${ws}`);
if (sub && sub.provider !== "none") throw new Error(`Refusing: "${w.name}" has a ${sub.provider} subscription (a real customer).`);
if (plan) {
  const [p] = await req<Array<{ id: string; retired_at: string | null }>>(`plans?select=id,retired_at&id=eq.${plan}`);
  if (!p || p.retired_at) throw new Error(`Unknown or retired plan "${plan}"`);
}
const [current] = await req<Array<Record<string, unknown>>>(`internal_plan_grants?select=*&workspace_id=eq.${ws}`);
console.log(`Workspace "${w.name}": subscription ${sub ? `${sub.plan_id} (${sub.status}, provider ${sub.provider})` : "none"}; current grant: ${current ? JSON.stringify(current) : "none"}`);

const body = revoke
  ? { workspace_id: ws, revoked_at: new Date().toISOString() }
  : {
    workspace_id: ws, plan_id: plan, reason: "internal_testing", granted_by: "scripts/grant-internal-plan.ts",
    note: opt("note") ?? "Internal testing entitlement (not a paid subscription)", granted_at: new Date().toISOString(),
    expires_at: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null, revoked_at: null,
  };
console.log(`${apply ? "Writing" : "Would write"}: ${JSON.stringify(body)}`);
if (apply) {
  if (revoke) await req(`internal_plan_grants?workspace_id=eq.${ws}`, { method: "PATCH", body: JSON.stringify({ revoked_at: body.revoked_at }) });
  else await req("internal_plan_grants?on_conflict=workspace_id", { method: "POST", body: JSON.stringify(body) });
  const usage = await req<Record<string, unknown>>("rpc/svc_workspace_usage", { method: "POST", body: JSON.stringify({ p_workspace_id: ws }) });
  console.log(`Now: plan ${usage.plan_id} via ${usage.entitlement}; keywords ${usage.active_keywords}/${usage.max_keywords}; mentions ${usage.mentions_consumed}/${usage.mention_allowance}.`);
} else {
  console.log("Dry run. Pass --apply to write.");
}
