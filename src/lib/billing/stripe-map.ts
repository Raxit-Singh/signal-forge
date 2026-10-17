// Stripe subscription → SignalForge subscription row (pure). Plans are matched by
// the Stripe Price ids stored on plans.stripe_price_id; anything else is ignored.

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete" | "unpaid" | "paused";

const STATUS: Record<string, SubscriptionStatus> = {
  active: "active", trialing: "trialing", past_due: "past_due", canceled: "canceled",
  incomplete: "incomplete", incomplete_expired: "canceled", unpaid: "unpaid", paused: "paused",
};

/** The fields of a Stripe Subscription object that SignalForge reads. */
export interface StripeSubscriptionLike {
  id: string;
  status: string;
  customer: string | { id: string };
  cancel_at_period_end?: boolean | null;
  metadata?: Record<string, string> | null;
  /** Older API versions; since 2025-03-31 the period lives on each item. */
  current_period_start?: number | null;
  current_period_end?: number | null;
  items?: { data?: Array<{ price?: { id?: string } | null; current_period_start?: number | null; current_period_end?: number | null }> };
}

export interface SubscriptionUpdate {
  workspaceId: string;
  planId: string;
  status: SubscriptionStatus;
  customerId: string;
  subscriptionId: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export type MapResult = { ok: true; update: SubscriptionUpdate } | { ok: false; reason: "no_workspace" | "unknown_price" | "several_prices" };

export function mapSubscription(sub: StripeSubscriptionLike, planByPrice: ReadonlyMap<string, string>, fallbackWorkspaceId?: string | null): MapResult {
  const workspaceId = sub.metadata?.workspace_id ?? fallbackWorkspaceId ?? null;
  if (!workspaceId || !/^[0-9a-f-]{36}$/.test(workspaceId)) return { ok: false, reason: "no_workspace" };
  const items = sub.items?.data ?? [];
  const plans = [...new Set(items.map((i) => (i.price?.id ? planByPrice.get(i.price.id) : undefined)).filter((p): p is string => !!p))];
  if (plans.length === 0) return { ok: false, reason: "unknown_price" };
  if (plans.length > 1) return { ok: false, reason: "several_prices" };
  const item = items.find((i) => i.price?.id && planByPrice.has(i.price.id));
  const start = item?.current_period_start ?? sub.current_period_start ?? null;
  const end = item?.current_period_end ?? sub.current_period_end ?? null;
  return {
    ok: true,
    update: {
      workspaceId, planId: plans[0]!, status: STATUS[sub.status] ?? "incomplete",
      customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      subscriptionId: sub.id,
      periodStart: start ? new Date(start * 1000) : null,
      periodEnd: end ? new Date(end * 1000) : null,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    },
  };
}

/** Webhook events SignalForge acts on; everything else is acknowledged and ignored. */
export const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);
