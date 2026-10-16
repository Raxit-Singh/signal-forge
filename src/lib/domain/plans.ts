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
  /** Active keywords per workspace (Free 1, Pro 10, Scale 40). */
  maxKeywords: number;
  /** Target for searching every keyword (not a guaranteed discovery time). */
  keywordRefreshTargetMinutes: number;
  retired: boolean;
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
  max_keywords?: number;
  keyword_refresh_target_minutes?: number;
  retired_at?: string | null;
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
    maxKeywords: row.max_keywords ?? 10,
    keywordRefreshTargetMinutes: row.keyword_refresh_target_minutes ?? 10080,
    retired: Boolean(row.retired_at),
  };
}

/** Mention allowance state for the current billing period (from `workspace_usage`). */
export interface WorkspaceUsage {
  planId: string;
  planName: string;
  /** "subscription", or an internal grant reason ("internal_testing", "development"). */
  entitlement: string;
  periodStart: string;
  periodEnd: string;
  mentionAllowance: number;
  mentionsConsumed: number;
  mentionsRemaining: number;
  mentionsHeld: number;
  mentionsNotHeld: number;
  exhaustedAt: string | null;
  meteringStartedAt: string | null;
  maxKeywords: number;
  activeKeywords: number;
  keywordRefreshTargetMinutes: number;
  monitoringIntervalMinutes: number;
}

export function usageFromRpc(r: Record<string, unknown>): WorkspaceUsage {
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    planId: String(r.plan_id), planName: String(r.plan_name), entitlement: String(r.entitlement ?? "subscription"),
    periodStart: String(r.period_start), periodEnd: String(r.period_end),
    mentionAllowance: n("mention_allowance"), mentionsConsumed: n("mentions_consumed"), mentionsRemaining: n("mentions_remaining"),
    mentionsHeld: n("mentions_held"), mentionsNotHeld: n("mentions_not_held"),
    exhaustedAt: (r.exhausted_at as string | null) ?? null, meteringStartedAt: (r.metering_started_at as string | null) ?? null,
    maxKeywords: n("max_keywords"), activeKeywords: n("active_keywords"),
    keywordRefreshTargetMinutes: n("keyword_refresh_target_minutes"), monitoringIntervalMinutes: n("monitoring_interval_minutes"),
  };
}

export type UsageLevel = "ok" | "warning" | "critical" | "exhausted";

/** Warning thresholds: 80 % warning, 90 % stronger warning, 100 % allowance used up. */
export function mentionUsageLevel(consumed: number, allowance: number): { percent: number; level: UsageLevel } {
  if (allowance <= 0) return { percent: 100, level: "exhausted" };
  const ratio = consumed / allowance;
  const percent = Math.min(100, Math.floor(ratio * 100));
  return { percent, level: ratio >= 1 ? "exhausted" : ratio >= 0.9 ? "critical" : ratio >= 0.8 ? "warning" : "ok" };
}

export function checkKeywordLimit(plan: Pick<Plan, "maxKeywords" | "name">, activeElsewhere: number, activeHere: number):
  { allowed: true } | { allowed: false; message: string } {
  if (activeElsewhere + activeHere <= plan.maxKeywords) return { allowed: true };
  const left = Math.max(0, plan.maxKeywords - activeElsewhere);
  return {
    allowed: false,
    message: `The ${plan.name} plan includes ${plan.maxKeywords} active keyword${plan.maxKeywords === 1 ? "" : "s"} per workspace`
      + (activeElsewhere > 0 ? ` (${left} left for this product)` : "") + ". Turn some off or change plan.",
  };
}

export type SubscriptionStatus =
  | "active" | "trialing" | "past_due" | "canceled" | "incomplete" | "unpaid" | "paused";

export interface InternalGrant {
  plan_id: string;
  reason: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export function grantIsActive(g: InternalGrant | null | undefined, now = new Date()): g is InternalGrant {
  return Boolean(g && !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > now));
}

/**
 * Mirrors private.effective_plan_id: an active internal grant (staff testing, not
 * billed) wins; otherwise lapsed subscriptions fall back to free.
 */
export function effectivePlanId(sub: { plan_id: string; status: SubscriptionStatus } | null, grant?: InternalGrant | null): string {
  if (grantIsActive(grant)) return grant.plan_id;
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
