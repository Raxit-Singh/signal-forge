import "server-only";
import DodoPayments from "dodopayments";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server/env";
import { HANDLED_EVENTS, mapSubscription, type DodoSubscriptionLike } from "@/lib/billing/dodo-map";

/** Dodo needs an API key; test mode (DODO_PAYMENTS_ENVIRONMENT=test_mode, the default) until launch. */
export function dodoEnabled(): boolean {
  return Boolean(serverEnv().DODO_PAYMENTS_API_KEY);
}

export const dodoMode = () => (serverEnv().DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live" : "test");

let client: DodoPayments | null = null;
export function dodo(): DodoPayments {
  const env = serverEnv();
  if (!env.DODO_PAYMENTS_API_KEY) throw new Error("DODO_PAYMENTS_API_KEY is not set");
  client ??= new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY, environment: env.DODO_PAYMENTS_ENVIRONMENT,
    webhookKey: env.DODO_PAYMENTS_WEBHOOK_KEY ?? null, maxRetries: 2, timeout: 20_000,
  });
  return client;
}

export interface DodoEvent {
  /** The webhook-id header: one per event, the same on every retry. */
  id: string;
  type: string;
  timestamp: string;
  data: unknown;
}

/** Verifies the Standard Webhooks signature over the raw body (5-minute tolerance); null when it doesn't verify. */
export function verifyWebhook(rawBody: string, headers: Headers): DodoEvent | null {
  const key = serverEnv().DODO_PAYMENTS_WEBHOOK_KEY;
  const id = headers.get("webhook-id");
  if (!key || !id) return null;
  const signed = {
    "webhook-id": id,
    "webhook-signature": headers.get("webhook-signature") ?? "",
    "webhook-timestamp": headers.get("webhook-timestamp") ?? "",
  };
  try {
    // Verification needs only the webhook key; the API key may be unset.
    const verifier = new DodoPayments({ bearerToken: serverEnv().DODO_PAYMENTS_API_KEY ?? "unused", webhookKey: key });
    const event = verifier.webhooks.unwrap(rawBody, { headers: signed });
    return { id, type: event.type, timestamp: event.timestamp, data: event.data };
  } catch {
    return null;
  }
}

async function planByProduct(admin: SupabaseClient): Promise<Map<string, string>> {
  // Monthly and yearly products both map to the plan.
  const { data } = await admin.from("plans").select("id, dodo_product_id, dodo_yearly_product_id");
  return new Map((data ?? []).flatMap((p) => [p.dodo_product_id, p.dodo_yearly_product_id].filter(Boolean).map((id) => [id as string, p.id as string] as const)));
}

/**
 * Applies one verified event. Idempotent: each webhook id is recorded once in billing_events (after it has been
 * applied, so a failure is retried); replays are acknowledged without effect. Subscription events carry the whole
 * subscription and are applied in Dodo's order (the event timestamp).
 */
export async function handleDodoEvent(admin: SupabaseClient, event: DodoEvent): Promise<string> {
  const { data: seen } = await admin.from("billing_events").select("processed_at").eq("id", event.id).maybeSingle();
  if (seen?.processed_at) return "duplicate";
  if (!HANDLED_EVENTS.has(event.type)) return record(admin, event, null, "ignored");

  const sub = event.data as DodoSubscriptionLike;
  const { data: owner } = await admin.from("subscriptions").select("workspace_id").eq("provider_customer_id", sub.customer?.customer_id ?? "").maybeSingle();
  const mapped = mapSubscription(sub, await planByProduct(admin), (owner?.workspace_id as string | undefined) ?? null);
  if (!mapped.ok) {
    console.error(`[dodo] ${event.type} ${event.id}: ${mapped.reason}`);
    return record(admin, event, null, mapped.reason);
  }
  const u = mapped.update;
  const { data: result, error } = await admin.rpc("svc_apply_billing_subscription", {
    p_provider: "dodo", p_workspace_id: u.workspaceId, p_plan_id: u.planId, p_status: u.status, p_customer: u.customerId, p_subscription: u.subscriptionId,
    p_period_start: u.periodStart?.toISOString() ?? null, p_period_end: u.periodEnd?.toISOString() ?? null,
    p_cancel_at_period_end: u.cancelAtPeriodEnd, p_event_at: new Date(event.timestamp).toISOString(), p_deleted: u.ended,
  });
  if (error) throw new Error(`apply subscription: ${error.message}`); // not recorded: Dodo retries
  return record(admin, event, u.workspaceId, String(result));
}

async function record(admin: SupabaseClient, event: DodoEvent, workspaceId: string | null, outcome: string) {
  await admin.from("billing_events").upsert({ id: event.id, provider: "dodo", type: event.type, workspace_id: workspaceId, processed_at: new Date().toISOString() });
  return outcome;
}

/** The workspace's Dodo customer, created on first checkout (metadata links it back). */
export async function customerFor(admin: SupabaseClient, workspaceId: string, email: string): Promise<string> {
  const { data: sub } = await admin.from("subscriptions").select("provider_customer_id").eq("workspace_id", workspaceId).maybeSingle();
  if (sub?.provider_customer_id) return sub.provider_customer_id as string;
  const { data: ws } = await admin.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
  const c = await dodo().customers.create({ name: (ws?.name as string | undefined) || email, email, metadata: { workspace_id: workspaceId } });
  await admin.rpc("svc_set_billing_customer", { p_workspace_id: workspaceId, p_customer: c.customer_id });
  // Two checkouts at once: the first customer stored wins.
  const { data: again } = await admin.from("subscriptions").select("provider_customer_id").eq("workspace_id", workspaceId).maybeSingle();
  return (again?.provider_customer_id as string | undefined) ?? c.customer_id;
}
