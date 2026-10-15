// Plan model mirrored from the `plans` table. Prices and limits come from the
// database, never from constants in UI code. The DB trigger is the authority;
// these helpers only produce friendly messages before a write is attempted.

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceCentsMonthly: number;
  currency: string;
  maxProducts: number;
  maxCompetitorsPerProduct: number;
  monthlyMentionLimit: number;
  historyDays: number;
  monitoringIntervalMinutes: number;
  monthlyAiTokenBudget: number;
  monthlyInvestigations: number;
  features: Record<string, boolean>;
}

export interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  price_cents_monthly: number;
  currency: string;
  max_products: number;
  max_competitors_per_product: number;
  monthly_mention_limit: number;
  history_days: number;
  monitoring_interval_minutes: number;
  monthly_ai_token_budget: number | string;
  monthly_investigations: number;
  features: unknown;
}

export function planFromRow(row: PlanRow): Plan {
  const features: Record<string, boolean> = {};
  if (row.features && typeof row.features === "object") {
    for (const [k, v] of Object.entries(row.features as Record<string, unknown>)) {
      features[k] = v === true;
    }
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCentsMonthly: row.price_cents_monthly,
    currency: row.currency,
    maxProducts: row.max_products,
    maxCompetitorsPerProduct: row.max_competitors_per_product,
    monthlyMentionLimit: row.monthly_mention_limit,
    historyDays: row.history_days,
    monitoringIntervalMinutes: row.monitoring_interval_minutes,
    monthlyAiTokenBudget: Number(row.monthly_ai_token_budget),
    monthlyInvestigations: row.monthly_investigations,
    features,
  };
}

export type SubscriptionStatus =
  | "active" | "trialing" | "past_due" | "canceled" | "incomplete" | "unpaid" | "paused";

/** Mirrors private.effective_plan_id: lapsed subscriptions fall back to free. */
export function effectivePlanId(sub: { plan_id: string; status: SubscriptionStatus } | null): string {
  if (!sub) return "free";
  return sub.status === "active" || sub.status === "trialing" || sub.status === "past_due" ? sub.plan_id : "free";
}

export function checkProductLimit(plan: Pick<Plan, "maxProducts" | "name">, activeProducts: number):
  { allowed: true; remaining: number } | { allowed: false; message: string } {
  if (activeProducts < plan.maxProducts) {
    return { allowed: true, remaining: plan.maxProducts - activeProducts };
  }
  const noun = plan.maxProducts === 1 ? "product" : "products";
  return {
    allowed: false,
    message: `The ${plan.name} plan includes ${plan.maxProducts} ${noun}. Archive a product or change plan to add another.`,
  };
}

export function formatPrice(cents: number, currency = "usd"): string {
  if (cents === 0) return "Free";
  const amount = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

/** Maps a Postgres error hint from plan-limit triggers to a user-facing message. */
export function planLimitMessage(err: { message?: string; hint?: string | null } | null | undefined): string | null {
  if (!err?.hint?.startsWith("plan_limit:")) return null;
  return err.message ?? "Plan limit reached.";
}
