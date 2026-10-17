"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";
import { customerFor, stripe, stripeEnabled } from "@/lib/server/billing/stripe";
import { site } from "@/lib/server/agent/http";

const checkoutSchema = z.object({ workspaceId: z.uuid(), planId: z.string().min(1).max(40) });

/** Stripe Checkout for a paid plan (workspace owners). Existing subscriptions change plans in the billing portal. */
export async function startCheckoutAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = checkoutSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  if (!stripeEnabled()) return failure("Online payment isn't set up on this server yet.");
  let email: string | null;
  try {
    email = (await requireWorkspaceRole(parsed.data.workspaceId, "owner")).user.email ?? null;
  } catch (e) {
    return failure(e instanceof AuthorizationError ? "Only the workspace owner can change the plan." : "Not allowed.");
  }
  const admin = createAdminClient();
  const [{ data: plan }, { data: sub }] = await Promise.all([
    admin.from("plans").select("id, stripe_price_id, is_public").eq("id", parsed.data.planId).maybeSingle(),
    admin.from("subscriptions").select("provider, provider_subscription_id, status").eq("workspace_id", parsed.data.workspaceId).maybeSingle(),
  ]);
  if (!plan?.is_public || !plan.stripe_price_id) return failure("That plan can't be bought online yet.");
  if (sub?.provider === "stripe" && sub.provider_subscription_id && ["active", "trialing", "past_due"].includes(sub.status as string)) {
    return failure("You already have a subscription: change plans in the billing portal.");
  }
  let url: string | null;
  try {
    const customer = await customerFor(admin, parsed.data.workspaceId, email);
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: parsed.data.workspaceId,
      line_items: [{ price: plan.stripe_price_id as string, quantity: 1 }],
      subscription_data: { metadata: { workspace_id: parsed.data.workspaceId } },
      metadata: { workspace_id: parsed.data.workspaceId },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      success_url: `${site()}/settings/billing?checkout=success`,
      cancel_url: `${site()}/settings/billing?checkout=cancelled`,
    }, { idempotencyKey: `checkout:${parsed.data.workspaceId}:${plan.id}:${Math.floor(Date.now() / 60_000)}` });
    url = session.url;
  } catch (e) {
    logServerError("checkout", e);
    return failure("Couldn't start checkout. Try again in a moment.");
  }
  if (!url) return failure("Couldn't start checkout.");
  redirect(url);
}

const portalSchema = z.object({ workspaceId: z.uuid() });

/** Stripe's billing portal: change plan, update the card, see invoices, cancel. */
export async function openBillingPortalAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = portalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  if (!stripeEnabled()) return failure("Online payment isn't set up on this server yet.");
  try {
    await requireWorkspaceRole(parsed.data.workspaceId, "owner");
  } catch {
    return failure("Only the workspace owner can manage billing.");
  }
  const { data: sub } = await createAdminClient().from("subscriptions").select("provider_customer_id").eq("workspace_id", parsed.data.workspaceId).maybeSingle();
  if (!sub?.provider_customer_id) return failure("There's no billing account yet: choose a plan first.");
  let url: string;
  try {
    // The configuration scripts/stripe-setup.ts created (plan switching between SignalForge prices); else the account default.
    const configs = await stripe().billingPortal.configurations.list({ active: true, limit: 20 });
    const configuration = configs.data.filter((c) => c.metadata?.app === "signalforge").sort((a, b) => b.created - a.created)[0]?.id;
    url = (await stripe().billingPortal.sessions.create({
      customer: sub.provider_customer_id as string, return_url: `${site()}/settings/billing`, ...(configuration ? { configuration } : {}),
    })).url;
  } catch (e) {
    logServerError("portal", e);
    return failure("Couldn't open the billing portal. Try again in a moment.");
  }
  redirect(url);
}

/**
 * Delivers mentions held after the allowance was used up, oldest first, up to the
 * remaining allowance of the CURRENT period (e.g. after an upgrade). Admins only.
 */
export async function releaseHeldMentionsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ workspaceId: z.uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  try {
    await requireWorkspaceRole(parsed.data.workspaceId, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("release_held_mentions", { p_workspace_id: parsed.data.workspaceId });
  if (error) {
    logServerError("releaseHeldMentions", error);
    return failure("Couldn't deliver held mentions.");
  }
  revalidatePath("/", "layout");
  const n = Number(data ?? 0);
  return { status: "success", message: n === 0 ? "No held mentions could be delivered (no allowance left)." : `Delivered ${n} held mention${n === 1 ? "" : "s"}.` };
}
