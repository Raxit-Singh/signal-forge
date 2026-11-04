import { expect, test } from "@playwright/test";
import { Webhook } from "standardwebhooks";
import { adminSelect, adminUpdate, createUser, createWorkspaceWithProduct, deleteUser, signInPath, type TestUser } from "./support";

// The Dodo Payments webhook end to end, without Dodo: events are signed exactly as Dodo
// signs them (Standard Webhooks), with the development webhook secret from .env.local.
// Checkout, plan changes and the customer portal need real Dodo test keys and aren't covered here.

const SECRET = process.env.DODO_PAYMENTS_WEBHOOK_KEY ?? "";
let user: TestUser | null = null;
let ids = { workspaceId: "", productId: "" };
let tempProduct: string | null = null;

test.skip(!SECRET, "DODO_PAYMENTS_WEBHOOK_KEY is not set");

test.beforeEach(async () => {
  user = await createUser();
  ids = await createWorkspaceWithProduct(user);
  const [pro] = await adminSelect<Array<{ dodo_product_id: string | null }>>("plans?id=eq.pro&select=dodo_product_id");
  if (!pro!.dodo_product_id) {
    tempProduct = "pdt_e2e_pro";
    await adminUpdate("plans?id=eq.pro", { dodo_product_id: tempProduct });
  }
});

test.afterEach(async () => {
  if (tempProduct) await adminUpdate("plans?id=eq.pro", { dodo_product_id: null });
  tempProduct = null;
  if (user) await deleteUser(user.id);
  user = null;
});

async function send(request: import("@playwright/test").APIRequestContext, id: string, event: Record<string, unknown>, opts: { badSignature?: boolean } = {}) {
  const payload = JSON.stringify(event);
  const at = new Date();
  const signer = new Webhook(opts.badSignature ? "whsec_d3JvbmcgZTJlIHNlY3JldCBmb3IgdGVzdHM=" : SECRET);
  return request.post("/api/dodo/webhook", {
    data: payload,
    headers: {
      "webhook-id": id, "webhook-timestamp": `${Math.floor(at.getTime() / 1000)}`, "webhook-signature": signer.sign(id, at, payload),
      "content-type": "application/json",
    },
  });
}

const subEvent = (type: string, at: Date, workspaceId: string, product: string, status = "active", extra: Record<string, unknown> = {}) => ({
  business_id: "bus_e2e", type, timestamp: at.toISOString(),
  data: {
    payload_type: "Subscription", subscription_id: "sub_e2e_1", status, product_id: product, quantity: 1,
    customer: { customer_id: "cus_e2e_1", email: "e2e@example.com", name: "E2E" }, metadata: { workspace_id: workspaceId },
    previous_billing_date: at.toISOString(), next_billing_date: new Date(at.getTime() + 30 * 86_400_000).toISOString(),
    cancel_at_next_billing_date: false, ...extra,
  },
});

test("signed events update the plan in order, once each; bad signatures are refused", async ({ request, page }) => {
  const product = tempProduct ?? (await adminSelect<Array<{ dodo_product_id: string }>>("plans?id=eq.pro&select=dodo_product_id"))[0]!.dodo_product_id;
  const now = Date.now();
  const at = (s: number) => new Date(now + s * 1000);
  const plan = async () => (await adminSelect<Array<{ plan_id: string; status: string; provider: string }>>(`subscriptions?workspace_id=eq.${ids.workspaceId}&select=plan_id,status,provider`))[0]!;

  const forged = await send(request, "msg_forged", subEvent("subscription.active", at(0), ids.workspaceId, product), { badSignature: true });
  expect(forged.status()).toBe(400);
  expect((await plan()).plan_id).toBe("free");

  const active = await send(request, `msg_${now}_1`, subEvent("subscription.active", at(0), ids.workspaceId, product));
  expect(active.status()).toBe(200);
  expect((await active.json()).outcome).toBe("applied");
  expect(await plan()).toEqual({ plan_id: "pro", status: "active", provider: "dodo" });

  const replay = await send(request, `msg_${now}_1`, subEvent("subscription.active", at(0), ids.workspaceId, product));
  expect((await replay.json()).outcome).toBe("duplicate");

  const pastDue = await send(request, `msg_${now}_2`, subEvent("subscription.past_due", at(60), ids.workspaceId, product, "past_due"));
  expect((await pastDue.json()).outcome).toBe("applied");
  const late = await send(request, `msg_${now}_0`, subEvent("subscription.updated", at(-60), ids.workspaceId, product, "active"));
  expect((await late.json()).outcome).toBe("stale");
  expect((await plan()).status).toBe("past_due");

  // The owner sees the failed payment.
  await page.goto(await signInPath(user!.email, "/settings/billing"));
  await expect(page.locator("#main").getByRole("alert").filter({ hasText: "Your last payment failed" })).toBeVisible();

  const unknown = await send(request, `msg_${now}_3`, subEvent("subscription.updated", at(90), ids.workspaceId, "pdt_unknown"));
  expect((await unknown.json()).outcome).toBe("unknown_product");

  const cancelled = await send(request, `msg_${now}_4`, subEvent("subscription.cancelled", at(120), ids.workspaceId, product, "cancelled"));
  expect((await cancelled.json()).outcome).toBe("downgraded");
  expect(await plan()).toEqual({ plan_id: "free", status: "active", provider: "none" });

  const ignored = await send(request, `msg_${now}_5`, { business_id: "bus_e2e", type: "payment.succeeded", timestamp: at(130).toISOString(), data: {} });
  expect((await ignored.json()).outcome).toBe("ignored");
});
