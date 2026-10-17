// One-time Stripe setup for the public paid plans (operator). Creates (or reuses,
// by lookup key) one Product + monthly Price per paid public plan at the plan's
// price, records the Price id in plans.stripe_price_id, and configures the billing
// portal (plan changes between these prices, card updates, invoices, cancel at
// period end). Prices come from the plans table; nothing is invented here.
//
//   node scripts/stripe-setup.ts            # dry run: shows what would happen
//   node scripts/stripe-setup.ts --apply    # test mode only unless --live is also given
//
// Refuses live keys unless --live is passed explicitly.
import { existsSync } from "node:fs";
import Stripe from "stripe";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");
const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("STRIPE_SECRET_KEY is not set (.env.local).");
if (key.startsWith("sk_live_") && !live) throw new Error("Refusing a live key without --live.");
if (!key.startsWith("sk_test_") && !key.startsWith("sk_live_") && !key.startsWith("rk_")) throw new Error("STRIPE_SECRET_KEY doesn't look like a Stripe secret key.");
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const stripe = new Stripe(key);

async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "content-type": "application/json", Prefer: "return=representation" } });
  if (!r.ok) throw new Error(`${path.split("?")[0]} → ${r.status} ${await r.text()}`);
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}

const plans = await db<Array<{ id: string; name: string; price_cents_monthly: number; currency: string; stripe_price_id: string | null }>>(
  "plans?select=id,name,price_cents_monthly,currency,stripe_price_id&is_public=eq.true&price_cents_monthly=gt.0&order=sort_order",
);
console.log(`Stripe ${key.startsWith("sk_live_") ? "LIVE" : "test"} mode · ${apply ? "applying" : "dry run"}`);
const prices: string[] = [];
for (const p of plans) {
  const lookup = `signalforge_${p.id}_monthly`;
  const existing = (await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 })).data[0];
  if (existing && existing.unit_amount === p.price_cents_monthly && existing.currency === p.currency.toLowerCase() && existing.recurring?.interval === "month") {
    console.log(`  ${p.name}: reusing ${existing.id} (${p.price_cents_monthly / 100} ${p.currency}/month)`);
    prices.push(existing.id);
    if (apply && p.stripe_price_id !== existing.id) await db(`plans?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ stripe_price_id: existing.id }) });
    continue;
  }
  console.log(`  ${p.name}: ${existing ? "price changed → new price" : "create"} ${p.price_cents_monthly / 100} ${p.currency}/month (lookup ${lookup})`);
  if (!apply) continue;
  const product = (await stripe.products.search({ query: `metadata['plan_id']:'${p.id}'` })).data[0]
    ?? await stripe.products.create({ name: `SignalForge ${p.name}`, metadata: { plan_id: p.id } });
  const price = await stripe.prices.create({
    product: product.id, currency: p.currency.toLowerCase(), unit_amount: p.price_cents_monthly, recurring: { interval: "month" },
    lookup_key: lookup, transfer_lookup_key: true, metadata: { plan_id: p.id },
  });
  prices.push(price.id);
  await db(`plans?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ stripe_price_id: price.id }) });
  console.log(`    → ${price.id}`);
}

if (apply && prices.length) {
  const byProduct = new Map<string, string[]>();
  for (const id of prices) {
    const pr = await stripe.prices.retrieve(id);
    const prod = typeof pr.product === "string" ? pr.product : pr.product.id;
    byProduct.set(prod, [...(byProduct.get(prod) ?? []), id]);
  }
  const cfg = await stripe.billingPortal.configurations.create({
    business_profile: { headline: "SignalForge billing" },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
      subscription_update: {
        enabled: true, default_allowed_updates: ["price"], proration_behavior: "create_prorations",
        products: [...byProduct].map(([product, ps]) => ({ product, prices: ps })),
      },
    },
    default_return_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/settings/billing`,
    metadata: { app: "signalforge" }, // the app opens the portal with the newest configuration tagged like this
  });
  console.log(`Billing portal configuration ${cfg.id} created.`);
}
console.log(apply ? "Done." : "Dry run only. Re-run with --apply.");
