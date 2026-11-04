// Dodo Payments subscription → Heardex subscription row (pure). Plans are matched by
// the Dodo product ids stored on plans.dodo_product_id; anything else is ignored.

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete" | "unpaid" | "paused";

/**
 * Dodo's statuses as Heardex stores them. `on_hold` (a renewal failed and the subscription waits for a new payment
 * method) is `unpaid`, which falls back to Free until it's paid; `past_due` keeps the plan through Dodo's grace period.
 * Ended subscriptions (`cancelled`, `expired`, `failed`) aren't statuses here: they return the workspace to Free.
 */
const STATUS: Record<string, SubscriptionStatus> = {
  pending: "incomplete", active: "active", on_hold: "unpaid", past_due: "past_due", paused: "paused",
};
export const ENDED = new Set(["cancelled", "expired", "failed"]);

/** The fields of a Dodo Subscription (as sent in subscription webhooks) that Heardex reads. */
export interface DodoSubscriptionLike {
  subscription_id: string;
  status: string;
  product_id: string;
  customer: { customer_id: string; metadata?: Record<string, string> | null };
  metadata?: Record<string, string> | null;
  previous_billing_date?: string | null;
  next_billing_date?: string | null;
  cancel_at_next_billing_date?: boolean | null;
}

export interface SubscriptionUpdate {
  workspaceId: string;
  planId: string;
  status: SubscriptionStatus;
  ended: boolean;
  customerId: string;
  subscriptionId: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export type MapResult = { ok: true; update: SubscriptionUpdate } | { ok: false; reason: "no_workspace" | "unknown_product" };

const UUID = /^[0-9a-f-]{36}$/;
const date = (s: string | null | undefined) => {
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/**
 * The workspace comes from the subscription's metadata (set at checkout), else the customer's (set when Heardex
 * created the customer), else `fallbackWorkspaceId` (the workspace that already has this customer).
 */
export function mapSubscription(sub: DodoSubscriptionLike, planByProduct: ReadonlyMap<string, string>, fallbackWorkspaceId?: string | null): MapResult {
  const workspaceId = [sub.metadata?.workspace_id, sub.customer.metadata?.workspace_id, fallbackWorkspaceId].find((w) => w && UUID.test(w));
  if (!workspaceId) return { ok: false, reason: "no_workspace" };
  const ended = ENDED.has(sub.status);
  const planId = planByProduct.get(sub.product_id);
  if (!planId && !ended) return { ok: false, reason: "unknown_product" };
  return {
    ok: true,
    update: {
      workspaceId, planId: planId ?? "free", status: STATUS[sub.status] ?? "incomplete", ended,
      customerId: sub.customer.customer_id,
      subscriptionId: sub.subscription_id,
      periodStart: date(sub.previous_billing_date),
      periodEnd: date(sub.next_billing_date),
      cancelAtPeriodEnd: Boolean(sub.cancel_at_next_billing_date),
    },
  };
}

/** Webhook events Heardex acts on; everything else is acknowledged and ignored. */
export const HANDLED_EVENTS = new Set([
  "subscription.active",
  "subscription.updated",
  "subscription.renewed",
  "subscription.plan_changed",
  "subscription.on_hold",
  "subscription.past_due",
  "subscription.paused",
  "subscription.unpaused",
  "subscription.cancelled",
  "subscription.expired",
  "subscription.failed",
]);
