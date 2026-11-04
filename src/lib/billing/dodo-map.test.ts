import { test } from "node:test";
import assert from "node:assert/strict";

import { mapSubscription } from "./dodo-map.ts";

const WS = "11111111-2222-3333-4444-555555555555";
const plans = new Map([["pdt_pro", "pro"], ["pdt_scale", "scale"]]);
const sub = (o: Record<string, unknown> = {}) => ({
  subscription_id: "sub_1", status: "active", product_id: "pdt_pro", customer: { customer_id: "cus_1" }, metadata: { workspace_id: WS },
  previous_billing_date: "2026-11-03T10:00:00Z", next_billing_date: "2026-12-03T10:00:00Z", cancel_at_next_billing_date: false, ...o,
});

test("maps plan by Dodo product, period from the billing dates, status as stored", () => {
  const r = mapSubscription(sub(), plans);
  assert.ok(r.ok);
  assert.deepEqual(r.update, {
    workspaceId: WS, planId: "pro", status: "active", ended: false, customerId: "cus_1", subscriptionId: "sub_1",
    periodStart: new Date("2026-11-03T10:00:00Z"), periodEnd: new Date("2026-12-03T10:00:00Z"), cancelAtPeriodEnd: false,
  });
});

test("workspace from the subscription, else the customer, else the workspace that has the customer", () => {
  const other = "99999999-2222-3333-4444-555555555555";
  assert.equal(mapSubscription(sub({ metadata: {}, customer: { customer_id: "cus_1", metadata: { workspace_id: other } } }), plans).ok, true);
  const r = mapSubscription(sub({ metadata: {} }), plans, other);
  assert.ok(r.ok && r.update.workspaceId === other);
  assert.deepEqual(mapSubscription(sub({ metadata: { workspace_id: "not-a-uuid" } }), plans), { ok: false, reason: "no_workspace" });
});

test("on hold falls back to Free until paid; past due keeps the plan; cancel at period end is kept", () => {
  const hold = mapSubscription(sub({ status: "on_hold" }), plans);
  assert.ok(hold.ok && hold.update.status === "unpaid");
  const due = mapSubscription(sub({ status: "past_due" }), plans);
  assert.ok(due.ok && due.update.status === "past_due");
  const leaving = mapSubscription(sub({ cancel_at_next_billing_date: true }), plans);
  assert.ok(leaving.ok && leaving.update.cancelAtPeriodEnd);
});

test("ended subscriptions are marked ended (even for a product no longer sold); unknown products are refused", () => {
  for (const status of ["cancelled", "expired", "failed"]) {
    const r = mapSubscription(sub({ status, product_id: "pdt_gone" }), plans);
    assert.ok(r.ok && r.update.ended, status);
  }
  assert.deepEqual(mapSubscription(sub({ product_id: "pdt_gone" }), plans), { ok: false, reason: "unknown_product" });
});
