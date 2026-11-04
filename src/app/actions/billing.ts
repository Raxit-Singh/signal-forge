"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";
import { customerFor, dodo, dodoEnabled } from "@/lib/server/billing/dodo";
import { site } from "@/lib/server/agent/http";

const LIVE = ["active", "trialing", "past_due", "unpaid", "paused"];
const checkoutSchema = z.object({ workspaceId: z.uuid(), planId: z.string().min(1).max(40), interval: z.enum(["month", "year"]).default("month") });

/** The plan's Dodo product for the billing interval (null: not sold that way yet). */
const productFor = (plan: { dodo_product_id: unknown; dodo_yearly_product_id: unknown }, interval: "month" | "year") =>
  ((interval === "year" ? plan.dodo_yearly_product_id : plan.dodo_product_id) as string | null) ?? null;

/** Dodo checkout for a paid plan (workspace owners). A workspace that already subscribes changes plan in place (changePlanAction). */
export async function startCheckoutAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = checkoutSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  if (!dodoEnabled()) return failure("Online payment isn't set up on this server yet.");
  let email: string | null;
  try {
    email = (await requireWorkspaceRole(parsed.data.workspaceId, "owner")).user.email ?? null;
  } catch (e) {
    return failure(e instanceof AuthorizationError ? "Only the workspace owner can change the plan." : "Not allowed.");
  }
  if (!email) return failure("Your account needs an email address to pay.");
  const admin = createAdminClient();
  const [{ data: plan }, { data: sub }] = await Promise.all([
    admin.from("plans").select("id, dodo_product_id, dodo_yearly_product_id, is_public").eq("id", parsed.data.planId).maybeSingle(),
    admin.from("subscriptions").select("provider, provider_subscription_id, status").eq("workspace_id", parsed.data.workspaceId).maybeSingle(),
  ]);
  const product = plan?.is_public ? productFor(plan, parsed.data.interval) : null;
  if (!plan || !product) return failure(`That plan can't be bought ${parsed.data.interval === "year" ? "yearly" : "online"} yet.`);
  if (sub?.provider === "dodo" && sub.provider_subscription_id && LIVE.includes(sub.status as string)) {
    return failure("You already have a subscription: change plan from the plan cards.");
  }
  let url: string;
  try {
    const customer = await customerFor(admin, parsed.data.workspaceId, email);
    const session = await dodo().checkoutSessions.create({
      product_cart: [{ product_id: product, quantity: 1 }],
      customer: { customer_id: customer },
      metadata: { workspace_id: parsed.data.workspaceId, plan_id: plan.id as string, interval: parsed.data.interval },
      return_url: `${site()}/settings/billing?checkout=done`,
      cancel_url: `${site()}/settings/billing?checkout=cancelled`,
      feature_flags: { allow_discount_code: true },
    });
    url = session.checkout_url ?? "";
  } catch (e) {
    logServerError("checkout", e);
    return failure("Couldn't start checkout. Try again in a moment.");
  }
  if (!url) return failure("Couldn't start checkout.");
  redirect(url);
}

/** Moves an existing subscription to another paid plan or billing interval at once, charging or crediting the difference (prorated). */
export async function changePlanAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = checkoutSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  if (!dodoEnabled()) return failure("Online payment isn't set up on this server yet.");
  try {
    await requireWorkspaceRole(parsed.data.workspaceId, "owner");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? "Only the workspace owner can change the plan." : "Not allowed.");
  }
  const admin = createAdminClient();
  const [{ data: plan }, { data: sub }] = await Promise.all([
    admin.from("plans").select("id, name, dodo_product_id, dodo_yearly_product_id, is_public").eq("id", parsed.data.planId).maybeSingle(),
    admin.from("subscriptions").select("provider, provider_subscription_id, status, plan_id").eq("workspace_id", parsed.data.workspaceId).maybeSingle(),
  ]);
  const product = plan?.is_public ? productFor(plan, parsed.data.interval) : null;
  if (!plan || !product) return failure(`That plan can't be bought ${parsed.data.interval === "year" ? "yearly" : "online"} yet.`);
  if (sub?.provider !== "dodo" || !sub.provider_subscription_id || !LIVE.includes(sub.status as string)) return failure("There's no subscription to change: choose a plan first.");
  const every = parsed.data.interval === "year" ? "yearly" : "monthly";
  try {
    const current = await dodo().subscriptions.retrieve(sub.provider_subscription_id as string);
    if (current.product_id === product) return { status: "error", message: `You're already on ${plan.name}, billed ${every}.` };
    await dodo().subscriptions.changePlan(sub.provider_subscription_id as string, {
      product_id: product, quantity: 1, proration_billing_mode: "prorated_immediately",
    });
  } catch (e) {
    logServerError("changePlan", e);
    return failure("Couldn't change the plan. Nothing was charged; try again in a moment.");
  }
  // The plan itself changes when Dodo confirms it (subscription.plan_changed webhook).
  revalidatePath("/settings/billing");
  return { status: "success", message: `Switching to ${plan.name}, billed ${every}. It applies as soon as the payment goes through, usually within seconds.` };
}

const portalSchema = z.object({ workspaceId: z.uuid() });

/** Dodo's customer portal: payment method, invoices, cancellation. */
export async function openBillingPortalAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = portalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  if (!dodoEnabled()) return failure("Online payment isn't set up on this server yet.");
  try {
    await requireWorkspaceRole(parsed.data.workspaceId, "owner");
  } catch {
    return failure("Only the workspace owner can manage billing.");
  }
  const { data: sub } = await createAdminClient().from("subscriptions").select("provider_customer_id").eq("workspace_id", parsed.data.workspaceId).maybeSingle();
  if (!sub?.provider_customer_id) return failure("There's no billing account yet: choose a plan first.");
  let url: string;
  try {
    url = (await dodo().customers.customerPortal.create(sub.provider_customer_id as string, { return_url: `${site()}/settings/billing` })).link;
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
