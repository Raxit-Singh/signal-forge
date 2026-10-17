import "server-only";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server/env";
import { HANDLED_EVENTS, mapSubscription, type StripeSubscriptionLike } from "@/lib/billing/stripe-map";

/** Stripe needs a secret key; test keys (sk_test_) in development. */
export function stripeEnabled(): boolean {
  return Boolean(serverEnv().STRIPE_SECRET_KEY);
}

let client: Stripe | null = null;
export function stripe(): Stripe {
  const key = serverEnv().STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "SignalForge" } });
  return client;
}

export const stripeMode = () => (serverEnv().STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "live" : "test");

async function planByPrice(admin: SupabaseClient): Promise<Map<string, string>> {
  const { data } = await admin.from("plans").select("id, stripe_price_id").not("stripe_price_id", "is", null);
  return new Map((data ?? []).map((p) => [p.stripe_price_id as string, p.id as string]));
}

/** Verifies the signature (raw body) and returns the event, or null when it doesn't verify. */
export function verifyWebhook(rawBody: string, signature: string | null): Stripe.Event | null {
  const secret = serverEnv().STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) return null;
  try {
    // A constructEvent-only client: verification needs no API key.
    return new Stripe(serverEnv().STRIPE_SECRET_KEY ?? "sk_test_unused").webhooks.constructEvent(rawBody, signature, secret, 300);
  } catch {
    return null;
  }
}

/**
 * Applies one verified event. Idempotent: each event id is recorded once in
 * billing_events; replays are acknowledged without effect. The subscription is
 * taken from the event (or fetched for checkout) and applied in Stripe's order.
 */
export async function handleStripeEvent(admin: SupabaseClient, event: Stripe.Event, fetchSubscription?: (id: string) => Promise<StripeSubscriptionLike>): Promise<string> {
  const { data: seen } = await admin.from("billing_events").select("processed_at").eq("id", event.id).maybeSingle();
  if (seen?.processed_at) return "duplicate";
  if (!HANDLED_EVENTS.has(event.type)) {
    await admin.from("billing_events").upsert({ id: event.id, provider: "stripe", type: event.type, processed_at: new Date().toISOString() });
    return "ignored";
  }

  let sub: StripeSubscriptionLike | null = null;
  let fallbackWorkspace: string | null = null;
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== "subscription" || !session.subscription) return record(admin, event, null, "ignored");
    fallbackWorkspace = session.client_reference_id ?? session.metadata?.workspace_id ?? null;
    const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    sub = fetchSubscription ? await fetchSubscription(id) : (await stripe().subscriptions.retrieve(id)) as unknown as StripeSubscriptionLike;
  } else {
    sub = event.data.object as unknown as StripeSubscriptionLike;
  }

  const mapped = mapSubscription(sub, await planByPrice(admin), fallbackWorkspace);
  if (!mapped.ok) {
    console.error(`[stripe] ${event.type} ${event.id}: ${mapped.reason}`);
    return record(admin, event, null, mapped.reason);
  }
  const u = mapped.update;
  const deleted = event.type === "customer.subscription.deleted" || u.status === "canceled";
  const { data: result, error } = await admin.rpc("svc_apply_subscription", {
    p_workspace_id: u.workspaceId, p_plan_id: u.planId, p_status: u.status, p_customer: u.customerId, p_subscription: u.subscriptionId,
    p_period_start: u.periodStart?.toISOString() ?? null, p_period_end: u.periodEnd?.toISOString() ?? null,
    p_cancel_at_period_end: u.cancelAtPeriodEnd, p_event_at: new Date(event.created * 1000).toISOString(), p_deleted: deleted,
  });
  if (error) throw new Error(`apply subscription: ${error.message}`); // not recorded: Stripe retries
  return record(admin, event, u.workspaceId, String(result));
}

async function record(admin: SupabaseClient, event: Stripe.Event, workspaceId: string | null, outcome: string) {
  await admin.from("billing_events").upsert({ id: event.id, provider: "stripe", type: event.type, workspace_id: workspaceId, processed_at: new Date().toISOString() });
  return outcome;
}

/** The workspace's Stripe customer, created on first checkout (metadata links it back). */
export async function customerFor(admin: SupabaseClient, workspaceId: string, email: string | null): Promise<string> {
  const { data: sub } = await admin.from("subscriptions").select("provider_customer_id").eq("workspace_id", workspaceId).maybeSingle();
  if (sub?.provider_customer_id) return sub.provider_customer_id as string;
  const { data: ws } = await admin.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
  const c = await stripe().customers.create(
    { name: (ws?.name as string | undefined) ?? undefined, email: email ?? undefined, metadata: { workspace_id: workspaceId } },
    { idempotencyKey: `customer:${workspaceId}` },
  );
  await admin.rpc("svc_set_billing_customer", { p_workspace_id: workspaceId, p_customer: c.id });
  const { data: again } = await admin.from("subscriptions").select("provider_customer_id").eq("workspace_id", workspaceId).maybeSingle();
  return (again?.provider_customer_id as string | undefined) ?? c.id;
}
