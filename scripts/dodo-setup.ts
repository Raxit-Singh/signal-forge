// One-time Dodo Payments setup for the public paid plans (operator). Creates (or reuses,
// by metadata plan_id, interval and price) a monthly subscription product per paid public
// plan, and a yearly one where the plan has a yearly price, and records their ids in
// plans.dodo_product_id and plans.dodo_yearly_product_id. Prices come from
// the plans table; nothing is invented here. A changed price gets a new product (existing
// subscribers stay on the old one until they change plan).
//
//   node scripts/dodo-setup.ts            # dry run: shows what would happen
//   node scripts/dodo-setup.ts --apply    # test mode only unless --live is also given
//
// Uses DODO_PAYMENTS_API_KEY and DODO_PAYMENTS_ENVIRONMENT from .env.local; refuses live_mode without --live.
import { existsSync } from "node:fs";
import DodoPayments from "dodopayments";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");
const key = process.env.DODO_PAYMENTS_API_KEY;
const environment = process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode";
if (!key) throw new Error("DODO_PAYMENTS_API_KEY is not set (.env.local).");
if (environment === "live_mode" && !live) throw new Error("Refusing live_mode without --live.");
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const dodo = new DodoPayments({ bearerToken: key, environment });

async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "content-type": "application/json", Prefer: "return=representation" } });
  if (!r.ok) throw new Error(`${path.split("?")[0]} → ${r.status} ${await r.text()}`);
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}

const plans = await db<Array<{
  id: string; name: string; description: string | null; price_cents_monthly: number; price_cents_yearly: number | null; currency: string;
  dodo_product_id: string | null; dodo_yearly_product_id: string | null;
}>>(
  "plans?select=id,name,description,price_cents_monthly,price_cents_yearly,currency,dodo_product_id,dodo_yearly_product_id&is_public=eq.true&price_cents_monthly=gt.0&order=sort_order",
);
console.log(`Dodo Payments ${environment === "live_mode" ? "LIVE" : "test"} mode · ${apply ? "applying" : "dry run"}`);

// Heardex's products (tagged app=heardex), by plan and interval (products made before yearly billing have no interval: monthly).
const ours = new Map<string, Array<{ id: string; price: number | null; currency: string | null }>>();
for await (const p of dodo.products.list({ recurring: true, archived: false })) {
  const plan = p.metadata?.plan_id;
  if (p.metadata?.app !== "heardex" || typeof plan !== "string") continue;
  const key = `${plan}:${p.metadata?.interval === "year" ? "year" : "month"}`;
  ours.set(key, [...(ours.get(key) ?? []), { id: p.product_id, price: p.price ?? null, currency: p.currency ?? null }]);
}

for (const p of plans) {
  const currency = p.currency.toUpperCase() as "USD";
  const offers = [
    { interval: "month" as const, price: p.price_cents_monthly, column: "dodo_product_id" as const, label: "month" },
    ...(p.price_cents_yearly ? [{ interval: "year" as const, price: p.price_cents_yearly, column: "dodo_yearly_product_id" as const, label: "year" }] : []),
  ];
  for (const o of offers) {
    const key = `${p.id}:${o.interval}`;
    const existing = (ours.get(key) ?? []).find((x) => x.price === o.price && x.currency === currency);
    if (existing) {
      console.log(`  ${p.name} ${o.interval}ly: reusing ${existing.id} (${o.price / 100} ${currency}/${o.label})`);
      if (apply && p[o.column] !== existing.id) await db(`plans?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ [o.column]: existing.id }) });
      continue;
    }
    console.log(`  ${p.name} ${o.interval}ly: ${ours.has(key) ? "price changed → new product" : "create"} ${o.price / 100} ${currency}/${o.label}`);
    if (!apply) continue;
    const product = await dodo.products.create({
      name: `Heardex ${p.name}${o.interval === "year" ? " (yearly)" : ""}`,
      description: p.description ?? undefined,
      tax_category: "saas",
      price: {
        type: "recurring_price", price: o.price, currency, discount: 0, purchasing_power_parity: false,
        // Renewing every month or year until cancelled (20 years is Dodo's recommended "until cancelled").
        payment_frequency_count: 1, payment_frequency_interval: o.interval === "year" ? "Year" : "Month",
        subscription_period_count: 20, subscription_period_interval: "Year",
      },
      metadata: { app: "heardex", plan_id: p.id, interval: o.interval },
    });
    await db(`plans?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ [o.column]: product.product_id }) });
    console.log(`    → ${product.product_id}`);
  }
}
console.log(apply ? "Done." : "Dry run only. Re-run with --apply.");
