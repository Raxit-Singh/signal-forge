import { expect, test } from "@playwright/test";
import Stripe from "stripe";
import { adminSelect, adminUpdate, createUser, createWorkspaceWithProduct, deleteUser, signInPath, type TestUser } from "./support";

// The Stripe webhook end to end, without Stripe: events are signed exactly as Stripe
// signs them, with the development webhook secret from .env.local. Checkout and the
// billing portal need real Stripe test keys and aren't covered here.

const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const signer = new Stripe("sk_test_unused");
let user: TestUser | null = null;
let ids = { workspaceId: "", productId: "" };
let tempPrice: string | null = null;

test.skip(!SECRET, "STRIPE_WEBHOOK_SECRET is not set");

test.beforeEach(async () => {
  user = await createUser();
  ids = await createWorkspaceWithProduct(user);
  const [pro] = await adminSelect<Array<{ stripe_price_id: string | null }>>("plans?id=eq.pro&select=stripe_price_id");
  if (!pro!.stripe_price_id) {
    tempPrice = "price_e2e_pro";
    await adminUpdate("plans?id=eq.pro", { stripe_price_id: tempPrice });
  }
});

test.afterEach(async () => {
  if (tempPrice) await adminUpdate("plans?id=eq.pro", { stripe_price_id: null });
  tempPrice = null;
  if (user) await deleteUser(user.id);
  user = null;
});

async function send(request: import("@playwright/test").APIRequestContext, event: Record<string, unknown>, opts: { badSignature?: boolean } = {}) {
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: opts.badSignature ? "whsec_wrong" : SECRET });
  return request.post("/api/stripe/webhook", { data: payload, headers: { "stripe-signature": header, "content-type": "application/json" } });
}

const subEvent = (id: string, type: string, created: number, workspaceId: string, price: string, status = "active", extra: Record<string, unknown> = {}) => ({
  id, object: "event", type, created, api_version: "2026-08-26.dahlia", livemode: false,
  data: { object: {
    id: "sub_e2e_1", object: "subscription", status, customer: "cus_e2e_1", cancel_at_period_end: false, metadata: { workspace_id: workspaceId },
    items: { object: "list", data: [{ id: "si_1", price: { id: price }, current_period_start: created, current_period_end: created + 30 * 86400 }] }, ...extra,
  } },
});

test("signed events update the plan in order, once each; bad signatures are refused", async ({ request, page }) => {
  const price = tempPrice ?? (await adminSelect<Array<{ stripe_price_id: string }>>("plans?id=eq.pro&select=stripe_price_id"))[0]!.stripe_price_id;
  const now = Math.floor(Date.now() / 1000);
  const plan = async () => (await adminSelect<Array<{ plan_id: string; status: string; provider: string }>>(`subscriptions?workspace_id=eq.${ids.workspaceId}&select=plan_id,status,provider`))[0]!;

  const forged = await send(request, subEvent("evt_forged", "customer.subscription.created", now, ids.workspaceId, price), { badSignature: true });
  expect(forged.status()).toBe(400);
  expect((await plan()).plan_id).toBe("free");

  const created = await send(request, subEvent(`evt_${now}_1`, "customer.subscription.created", now, ids.workspaceId, price));
  expect(created.status()).toBe(200);
  expect((await created.json()).outcome).toBe("applied");
  expect(await plan()).toEqual({ plan_id: "pro", status: "active", provider: "stripe" });

  const replay = await send(request, subEvent(`evt_${now}_1`, "customer.subscription.created", now, ids.workspaceId, price));
  expect((await replay.json()).outcome).toBe("duplicate");

  const pastDue = await send(request, subEvent(`evt_${now}_2`, "customer.subscription.updated", now + 60, ids.workspaceId, price, "past_due"));
  expect((await pastDue.json()).outcome).toBe("applied");
  const late = await send(request, subEvent(`evt_${now}_0`, "customer.subscription.updated", now - 60, ids.workspaceId, price, "active"));
  expect((await late.json()).outcome).toBe("stale");
  expect((await plan()).status).toBe("past_due");

  // The owner sees the failed payment.
  await page.goto(await signInPath(user!.email, "/settings/billing"));
  await expect(page.locator("#main").getByRole("alert").filter({ hasText: "Your last payment failed" })).toBeVisible();

  const unknown = await send(request, subEvent(`evt_${now}_3`, "customer.subscription.updated", now + 90, ids.workspaceId, "price_unknown"));
  expect((await unknown.json()).outcome).toBe("unknown_price");

  const deleted = await send(request, subEvent(`evt_${now}_4`, "customer.subscription.deleted", now + 120, ids.workspaceId, price, "canceled"));
  expect((await deleted.json()).outcome).toBe("downgraded");
  expect(await plan()).toEqual({ plan_id: "free", status: "active", provider: "none" });

  const ignored = await send(request, { id: `evt_${now}_5`, object: "event", type: "invoice.created", created: now, data: { object: {} } });
  expect((await ignored.json()).outcome).toBe("ignored");
});
