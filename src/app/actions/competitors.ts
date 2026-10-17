"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidSchema } from "@/lib/validation/schemas";
import { planLimitMessage } from "@/lib/domain/plans";
import { failure, invalid, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";
import { COMPETITOR_MAX_KEYWORDS, syncOptimizedQueries } from "@/lib/server/collection/query-sync";

const keywordList = z.string().max(400).optional().transform((v) =>
  (v ?? "").split(/[,\n]/).map((k) => k.trim().replace(/\s+/g, " ")).filter(Boolean));

const competitorSchema = z.object({
  name: z.string().trim().min(2, { error: "At least 2 characters." }).max(80, { error: "At most 80 characters." }),
  websiteUrl: z.string().trim().max(2048).optional().transform((v) => v || null)
    .pipe(z.url({ protocol: /^https?$/, error: "Enter a full address starting with https://" }).nullable()),
  keywords: keywordList.refine((k) => k.length <= COMPETITOR_MAX_KEYWORDS - 1, {
    error: `Up to ${COMPETITOR_MAX_KEYWORDS - 1} extra keywords (the name is always one).`,
  }),
});

function writeError(error: { code?: string; message: string; hint?: string | null }, scope: string): ActionState {
  const limit = planLimitMessage(error);
  if (limit) return failure(limit);
  if (error.code === "23505") return { status: "error", message: "You already track a competitor with that name.", fields: { name: "Name already used." } };
  if (error.code === "22023") return failure(error.message);
  logServerError(scope, error);
  return failure("Couldn't save the competitor. Try again.");
}

/** Creates or refreshes the competitor's searches on every source (after the database write). */
async function resync(trackingProductId: string | null) {
  if (!trackingProductId) return;
  try {
    await syncOptimizedQueries(createAdminClient(), trackingProductId);
  } catch (e) {
    logServerError("competitorSync", e);
  }
}

async function authorize(productId: string) {
  const supabase = await createClient();
  const { data: product } = await supabase.from("products").select("id, workspace_id, competitor_of").eq("id", productId).maybeSingle();
  if (!product || product.competitor_of) return { error: failure("Product not found.") };
  try {
    await requireWorkspaceRole(product.workspace_id as string, "admin");
  } catch (e) {
    return { error: failure(e instanceof AuthorizationError ? e.message : "Not allowed.") };
  }
  return { supabase };
}

export async function addCompetitorAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const productId = uuidSchema.safeParse(formData.get("productId"));
  if (!productId.success) return failure("Invalid product.");
  const parsed = competitorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const auth = await authorize(productId.data);
  if ("error" in auth) return auth.error!;

  const { data: id, error } = await auth.supabase.rpc("add_competitor", {
    p_product_id: productId.data, p_name: parsed.data.name, p_website: parsed.data.websiteUrl, p_keywords: parsed.data.keywords,
  });
  if (error || !id) return writeError(error ?? { message: "no id" }, "addCompetitor");
  const { data: c } = await auth.supabase.from("competitors").select("tracking_product_id").eq("id", id as string).maybeSingle();
  await resync((c?.tracking_product_id as string | null) ?? null);
  revalidatePath("/competitors");
  return { status: "success", message: `Tracking ${parsed.data.name}. Mentions appear as its first checks finish.` };
}

export async function updateCompetitorAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const id = uuidSchema.safeParse(formData.get("competitorId"));
  if (!id.success) return failure("Invalid competitor.");
  const parsed = competitorSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const supabase = await createClient();
  const { data: c } = await supabase.from("competitors").select("product_id, enabled, tracking_product_id").eq("id", id.data).maybeSingle();
  if (!c) return failure("Competitor not found.");
  const auth = await authorize(c.product_id as string);
  if ("error" in auth) return auth.error!;
  const enabled = formData.has("enabled") ? formData.get("enabled") === "true" : Boolean(c.enabled);

  const { error } = await auth.supabase.rpc("update_competitor", {
    p_competitor_id: id.data, p_name: parsed.data.name, p_website: parsed.data.websiteUrl, p_keywords: parsed.data.keywords, p_enabled: enabled,
  });
  if (error) return writeError(error, "updateCompetitor");
  await resync(c.tracking_product_id as string | null);
  revalidatePath("/competitors");
  return { status: "success", message: enabled ? "Saved." : `Paused ${parsed.data.name}: nothing new is collected until you resume.` };
}

export async function removeCompetitorAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const id = uuidSchema.safeParse(formData.get("competitorId"));
  if (!id.success) return failure("Invalid competitor.");
  const supabase = await createClient();
  const { data: c } = await supabase.from("competitors").select("product_id, name").eq("id", id.data).maybeSingle();
  if (!c) return failure("Competitor not found.");
  const auth = await authorize(c.product_id as string);
  if ("error" in auth) return auth.error!;
  const { error } = await auth.supabase.rpc("remove_competitor", { p_competitor_id: id.data });
  if (error) return writeError(error, "removeCompetitor");
  revalidatePath("/competitors");
  return { status: "success", message: `Removed ${c.name as string} and its collected mentions.` };
}
