"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, getUser, requireWorkspaceRole } from "@/lib/server/session";
import { refreshActivity } from "@/lib/server/collection/activity";
import { resolveEnablement, syncOptimizedQueries } from "@/lib/server/collection/query-sync";
import { getAdapters, paidCollectionEnabled } from "@/lib/server/collection/sources";
import { connectedSources } from "@/lib/server/collection/connections";
import { isLegacySource, isPaidSource, isPublicSource } from "@/lib/sources/registry";

async function authorizeProduct(productId: string) {
  const user = await getUser();
  if (!user) throw new AuthorizationError("Your session has expired. Sign in again.");
  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products").select("id, workspace_id, website_url, app_store_url, play_store_url, archived_at").eq("id", productId).maybeSingle();
  if (!product || product.archived_at) throw new AuthorizationError("Product not found.");
  await requireWorkspaceRole(product.workspace_id as string, "admin");
  return { user, supabase, product };
}

async function resync(productId: string) {
  try {
    await syncOptimizedQueries(createAdminClient(), productId);
  } catch (e) {
    logServerError("monitoring.resync", e);
  }
  revalidatePath("/monitoring");
  revalidatePath("/integrations");
}

const sourceSchema = z.object({
  productId: z.uuid(),
  platform: z.string().refine(isPublicSource),
  enabled: z.enum(["true", "false"]),
  confirmPaid: z.string().optional(),
});

/**
 * Turns a source on/off for a product. Turning on a paid source is an explicit
 * spending authorization, so it requires the confirmation box.
 */
export async function setSourceEnabledAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = sourceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid source.");
  const { productId, platform, enabled } = parsed.data;
  if (isLegacySource(platform)) return failure("This source follows your keywords and can't be switched off separately.");
  const on = enabled === "true";
  try {
    const { user, supabase, product } = await authorizeProduct(productId);
    if (on && isPaidSource(platform)) {
      if (!paidCollectionEnabled()) return failure("Paid sources are switched off on this server.");
      const { data: ctx } = await createAdminClient().rpc("svc_schedule_context", { p_product_id: productId, p_platform: platform });
      if (Number((ctx as { paid_allowance_usd?: number } | null)?.paid_allowance_usd ?? 0) <= 0) {
        return failure("Paid sources aren't included in your plan.");
      }
      if (parsed.data.confirmPaid !== "yes") {
        return failure("Confirm that this paid source may use your plan's paid-source allowance.");
      }
    }
    if (on) {
      const connected = await connectedSources(createAdminClient(), productId, product.workspace_id as string);
      const e = resolveEnablement(getAdapters(), product as never, new Map([[platform, true]]), Number.POSITIVE_INFINITY, paidCollectionEnabled(), connected)
        .find((x) => x.id === platform);
      if (e && !e.enabled) return failure(e.reason ?? "This source can't be enabled.");
    }
    const { error } = await supabase.from("product_source_settings").upsert(
      { workspace_id: product.workspace_id, product_id: productId, platform, enabled: on, updated_by: user.id },
      { onConflict: "product_id,platform" },
    );
    if (error) throw error;
  } catch (e) {
    if (e instanceof AuthorizationError) return failure(e.message);
    logServerError("setSourceEnabled", e);
    return failure("Couldn't update the source.");
  }
  await resync(productId);
  return { status: "success", message: on ? "Source turned on. It will be checked at its next scheduled time." : "Source turned off. Collected mentions are kept." };
}

const boostSchema = z.object({
  productId: z.uuid(),
  title: z.string().trim().min(1, "Give the boost a name.").max(120),
  startsAt: z.iso.datetime({ offset: true, local: true }),
  endsAt: z.iso.datetime({ offset: true, local: true }),
  maxPaidChecks: z.coerce.number().int().min(0).max(100000).default(0),
  confirmPaid: z.string().optional(),
  tzOffsetMinutes: z.coerce.number().int().min(-900).max(900).default(0),
});

function parseLocal(value: string, tzOffsetMinutes: number): Date {
  // <input type="datetime-local"> has no zone; the browser sends its UTC offset alongside.
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) return new Date(value);
  return new Date(new Date(`${value}Z`).getTime() + tzOffsetMinutes * 60_000);
}

export async function createBoostAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = boostSchema.safeParse(Object.fromEntries(formData));
  const platforms = formData.getAll("platforms").map(String).filter(isPublicSource);
  if (!parsed.success) return failure(parsed.error.issues[0]?.message ?? "Check the boost details.");
  if (platforms.length === 0) return failure("Choose at least one platform to boost.");
  const d = parsed.data;
  const startsAt = parseLocal(d.startsAt, d.tzOffsetMinutes);
  const endsAt = parseLocal(d.endsAt, d.tzOffsetMinutes);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return failure("Invalid dates.");
  if (startsAt.getTime() < Date.now() - 10 * 60_000) return failure("A boost can't start in the past.");
  if (endsAt <= startsAt) return failure("The end must be after the start.");
  if (endsAt.getTime() - startsAt.getTime() > 14 * 86_400_000) return failure("A boost can last at most 14 days.");

  const paidPlatforms = platforms.filter(isPaidSource);
  try {
    const { user, supabase, product } = await authorizeProduct(d.productId);
    const admin = createAdminClient();
    const { data: ctx } = await admin.rpc("svc_schedule_context", { p_product_id: d.productId, p_platform: platforms[0] });
    const maxChecks = Number((ctx as { max_boost_paid_checks?: number } | null)?.max_boost_paid_checks ?? 0);
    let paidChecks = 0;
    if (paidPlatforms.length > 0) {
      if (d.maxPaidChecks <= 0) return failure("Set how many extra paid checks this boost may use, or remove the paid platforms.");
      if (d.maxPaidChecks > maxChecks) return failure(`Your plan allows at most ${maxChecks} paid checks per boost.`);
      if (d.confirmPaid !== "yes") return failure("Confirm the paid checks to activate a boost on paid platforms.");
      paidChecks = d.maxPaidChecks;
    }
    const { data: active } = await supabase.from("monitoring_queries").select("provider").eq("product_id", d.productId).eq("enabled", true);
    const monitored = new Set((active ?? []).map((q) => q.provider as string));
    const notMonitored = platforms.filter((p) => !monitored.has(p));
    if (notMonitored.length) return failure(`Not monitored for this product yet: ${notMonitored.join(", ")}. Turn them on first.`);

    const { error } = await supabase.from("launch_boosts").insert({
      workspace_id: product.workspace_id, product_id: d.productId, title: d.title, platforms, mode: "priority",
      starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), max_paid_checks: paidChecks,
      paid_authorized_by: paidChecks > 0 ? user.id : null, paid_authorized_at: paidChecks > 0 ? new Date().toISOString() : null,
      created_by: user.id,
    });
    if (error) throw error;
    // A boost that starts now takes effect at once: re-rank so the shorter interval applies
    // to the next run instead of waiting out the old one (no API calls).
    if (startsAt.getTime() <= Date.now() + 60_000) await refreshActivity(admin, d.productId).catch((e) => logServerError("createBoost.refresh", e));
  } catch (e) {
    if (e instanceof AuthorizationError) return failure(e.message);
    logServerError("createBoost", e);
    return failure("Couldn't create the boost.");
  }
  revalidatePath("/monitoring");
  return { status: "success", message: "Launch Boost scheduled. Monitoring returns to normal automatically when it ends." };
}

export async function cancelBoostAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const id = z.uuid().safeParse(formData.get("boostId"));
  const productId = z.uuid().safeParse(formData.get("productId"));
  if (!id.success || !productId.success) return failure("Invalid boost.");
  try {
    const { supabase } = await authorizeProduct(productId.data);
    const { error } = await supabase.from("launch_boosts").update({ canceled_at: new Date().toISOString() })
      .eq("id", id.data).eq("product_id", productId.data).is("canceled_at", null);
    if (error) throw error;
    // Back to the automatic intervals right away.
    await refreshActivity(createAdminClient(), productId.data).catch((e) => logServerError("cancelBoost.refresh", e));
  } catch (e) {
    if (e instanceof AuthorizationError) return failure(e.message);
    logServerError("cancelBoost", e);
    return failure("Couldn't cancel the boost.");
  }
  revalidatePath("/monitoring");
  return { status: "success", message: "Boost canceled. Normal monitoring resumes from each source's next check." };
}

/** Stop scan / Resume scanning for a product (and its competitors). Admins only; enforced again in SQL. */
export async function setScanningAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const p = z.object({ productId: z.uuid(), stop: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!p.success) return failure("Invalid request.");
  let supabase;
  try {
    ({ supabase } = await authorizeProduct(p.data.productId));
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const stop = p.data.stop === "true";
  const { error } = await supabase.rpc("set_product_scanning", { p_product_id: p.data.productId, p_stop: stop });
  if (error) {
    logServerError("setScanning", error);
    return failure(stop ? "Couldn't stop scanning." : "Couldn't resume scanning.");
  }
  if (!stop) {
    try {
      await refreshActivity(createAdminClient(), p.data.productId);
    } catch (e) {
      logServerError("setScanning.refresh", e);
    }
  }
  revalidatePath("/", "layout");
  return {
    status: "success",
    message: stop
      ? "Scanning stopped. No platform is searched for this product or its competitors until you resume. Collected data is kept."
      : "Scanning resumed. Every search runs again now, within your plan and budgets.",
  };
}
