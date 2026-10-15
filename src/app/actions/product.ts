"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { productSchema, aliasListSchema, uuidSchema } from "@/lib/validation/schemas";
import { planLimitMessage } from "@/lib/domain/plans";
import { failure, invalid, logServerError, type ActionState } from "@/lib/server/action-result";
import {
  AuthorizationError, PRODUCT_COOKIE, getActiveWorkspace, requireWorkspaceRole,
} from "@/lib/server/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncOptimizedQueries } from "@/lib/server/collection/query-sync";

/** Rebuilds a product's per-platform query groups (after the caller's authorization check). */
async function resyncQueries(productId: string) {
  try {
    await syncOptimizedQueries(createAdminClient(), productId);
  } catch (e) {
    logServerError("syncQueries", e);
  }
}

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };

function productColumns(d: z.output<typeof productSchema>) {
  return {
    name: d.name,
    website_url: d.websiteUrl?.url ?? null,
    description: d.description,
    category: d.category,
    target_audience: d.targetAudience,
    app_store_url: d.appStoreUrl?.url ?? null,
    play_store_url: d.playStoreUrl?.url ?? null,
    github_repo: d.githubRepo?.fullName ?? null,
  };
}

function productWriteError(error: { code?: string; message: string; hint?: string | null }, scope: string): ActionState {
  const limit = planLimitMessage(error);
  if (limit) return failure(limit);
  if (error.code === "23505") {
    return { status: "error", message: "You already have a product with that name.", fields: { name: "Name already used." } };
  }
  if (error.code === "23514") return failure("One of the fields has an invalid value.");
  logServerError(scope, error);
  return failure("Couldn't save the product. Try again.");
}

/** Onboarding step 1 (and "Add product" later). */
export async function createProductAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const workspace = await getActiveWorkspace();
  if (!workspace) return failure("Create a workspace first.");
  try {
    await requireWorkspaceRole(workspace.id, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }

  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("products")
    .insert({ ...productColumns(parsed.data), workspace_id: workspace.id, created_by: user!.id, onboarding_step: 2 })
    .select("id")
    .single();
  if (error) return productWriteError(error, "createProduct");

  (await cookies()).set(PRODUCT_COOKIE, data.id as string, COOKIE_OPTS);
  redirect(`/onboarding/${data.id}/keywords`);
}

export async function updateProductAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const id = uuidSchema.safeParse(formData.get("productId"));
  if (!id.success) return failure("Invalid product.");
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: product } = await supabase.from("products").select("workspace_id").eq("id", id.data).maybeSingle();
  if (!product) return failure("Product not found.");
  try {
    await requireWorkspaceRole(product.workspace_id as string, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const { error } = await supabase.from("products").update(productColumns(parsed.data)).eq("id", id.data);
  if (error) return productWriteError(error, "updateProduct");
  // Website / App Store URL drive Trustpilot and App Store collection.
  await resyncQueries(id.data);
  revalidatePath("/", "layout");
  return { status: "success", message: "Product saved." };
}

const aliasPayload = z.object({
  productId: z.uuid(),
  aliases: z.string().max(100_000).transform((s, ctx) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "Malformed keyword list." });
      return z.NEVER;
    }
  }).pipe(aliasListSchema),
  mode: z.enum(["onboarding", "settings"]).default("settings"),
});

/** Onboarding step 2 / settings: replace the keyword list atomically. */
export async function saveAliasesAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = aliasPayload.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { productId, aliases, mode } = parsed.data;

  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products").select("workspace_id, onboarding_step").eq("id", productId).maybeSingle();
  if (!product) return failure("Product not found.");
  try {
    await requireWorkspaceRole(product.workspace_id as string, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }

  const { error } = await supabase.rpc("replace_product_aliases", {
    p_product_id: productId,
    p_aliases: aliases.map((a) => ({
      term: a.term,
      kind: a.kind,
      is_ambiguous: a.isAmbiguous,
      context_terms: a.contextTerms,
      negative_terms: a.negativeTerms,
      enabled: a.enabled,
      source: a.source,
    })),
  });
  if (error) {
    logServerError("saveAliases", error);
    return failure(error.code === "23505" ? "Each keyword can only appear once." : "Couldn't save keywords.");
  }
  await resyncQueries(productId);

  if (mode === "onboarding") {
    if ((product.onboarding_step as number) < 3) {
      await supabase.from("products").update({ onboarding_step: 3 }).eq("id", productId);
    }
    redirect(`/onboarding/${productId}/sources`);
  }
  revalidatePath("/settings/products");
  return { status: "success", message: "Keywords saved." };
}

const stepPayload = z.object({
  productId: z.uuid(),
  step: z.coerce.number().int().min(3).max(6),
});

const STEP_ROUTES: Record<number, string> = { 3: "sources", 4: "ai", 5: "scan" };

/** Moves onboarding forward (never backward). Step 6 = finished. */
export async function advanceOnboardingAction(formData: FormData): Promise<void> {
  const parsed = stepPayload.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/overview");
  const { productId, step } = parsed.data;

  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products").select("workspace_id, onboarding_step").eq("id", productId).maybeSingle();
  if (!product) redirect("/overview");
  try {
    await requireWorkspaceRole(product.workspace_id as string, "admin");
  } catch {
    redirect("/overview");
  }
  if ((product.onboarding_step as number) < step) {
    await supabase.from("products").update({ onboarding_step: step }).eq("id", productId);
  }
  if (step >= 6) {
    await supabase
      .from("workspaces")
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq("id", product.workspace_id as string)
      .is("onboarding_completed_at", null);
    revalidatePath("/", "layout");
    redirect("/overview");
  }
  redirect(`/onboarding/${productId}/${STEP_ROUTES[step]}`);
}

export async function archiveProductAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const id = uuidSchema.safeParse(formData.get("productId"));
  if (!id.success) return failure("Invalid product.");
  const supabase = await createClient();
  const { data: product } = await supabase.from("products").select("workspace_id, name").eq("id", id.data).maybeSingle();
  if (!product) return failure("Product not found.");
  try {
    await requireWorkspaceRole(product.workspace_id as string, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  if (String(formData.get("confirm") ?? "").trim() !== product.name) {
    return { status: "error", message: "Type the product name to confirm.", fields: { confirm: "Doesn't match." } };
  }
  const { error } = await supabase.from("products").update({ archived_at: new Date().toISOString() }).eq("id", id.data);
  if (error) {
    logServerError("archiveProduct", error);
    return failure("Couldn't archive the product.");
  }
  (await cookies()).delete(PRODUCT_COOKIE);
  revalidatePath("/", "layout");
  return { status: "success", message: "Product archived. Monitoring for it has stopped." };
}
