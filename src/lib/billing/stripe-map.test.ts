import { test } from "node:test";
import assert from "node:assert/strict";

import { mapSubscription } from "./stripe-map.ts";

const WS = "11111111-2222-3333-4444-555555555555";
const plans = new Map([["price_pro", "pro"], ["price_scale", "scale"]]);
const sub = (o: Record<string, unknown> = {}) => ({
  id: "sub_1", status: "active", customer: "cus_1", cancel_at_period_end: false, metadata: { workspace_id: WS },
  items: { data: [{ price: { id: "price_pro" }, current_period_start: 1_760_000_000, current_period_end: 1_762_600_000 }] }, ...o,
});

test("maps plan by Stripe price, period from the item (current API), status as stored", () => {
  const r = mapSubscription(sub(), plans);
  assert.ok(r.ok);
  assert.deepEqual(r.update, {
    workspaceId: WS, planId: "pro", status: "active", customerId: "cus_1", subscriptionId: "sub_1",
    periodStart: new Date(1_760_000_000_000), periodEnd: new Date(1_762_600_000_000), cancelAtPeriodEnd: false,
  });
});

test("older API shape (period on the subscription) and expanded customer still work", () => {
  const r = mapSubscription(sub({ customer: { id: "cus_9" }, current_period_start: 10, current_period_end: 20, items: { data: [{ price: { id: "price_scale" } }] } }), plans);
  assert.ok(r.ok && r.update.planId === "scale" && r.update.customerId === "cus_9" && r.update.periodEnd?.getTime() === 20_000);
});

test("statuses: incomplete_expired ends it; unknown statuses never grant a plan", () => {
  assert.equal((mapSubscription(sub({ status: "incomplete_expired" }), plans) as { update: { status: string } }).update.status, "canceled");
  assert.equal((mapSubscription(sub({ status: "something_new" }), plans) as { update: { status: string } }).update.status, "incomplete");
});

test("refuses what it can't attribute: no workspace, unknown price, mixed plans", () => {
  assert.deepEqual(mapSubscription(sub({ metadata: {} }), plans), { ok: false, reason: "no_workspace" });
  assert.equal(mapSubscription(sub({ metadata: {} }), plans, WS).ok, true, "checkout's client_reference_id can supply it");
  assert.deepEqual(mapSubscription(sub({ metadata: { workspace_id: "not-a-uuid" } }), plans), { ok: false, reason: "no_workspace" });
  assert.deepEqual(mapSubscription(sub({ items: { data: [{ price: { id: "price_other" } }] } }), plans), { ok: false, reason: "unknown_price" });
  assert.deepEqual(mapSubscription(sub({ items: { data: [{ price: { id: "price_pro" } }, { price: { id: "price_scale" } }] } }), plans), { ok: false, reason: "several_prices" });
});
