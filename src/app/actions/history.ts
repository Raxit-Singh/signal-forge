"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidSchema } from "@/lib/validation/schemas";
import { resolveHistoryRange } from "@/lib/domain/history";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, getUser, getWorkspacePlan, requireWorkspaceRole } from "@/lib/server/session";
import { startBackfill } from "@/lib/server/collection/backfill";
import { runWorker } from "@/lib/server/collection/worker";

/**
 * Starts a historical search for a product over the range the customer chose
 * (validated against the plan's history window). Runs a first batch right away;
 * the scheduler continues it in bounded, resumable steps.
 */
export async function startHistoricalSearchAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const productId = uuidSchema.safeParse(formData.get("productId"));
  if (!productId.success) return failure("Invalid product.");
  const user = await getUser();
  if (!user) return failure("Your session has expired. Sign in again.");

  const supabase = await createClient();
  const { data: product } = await supabase.from("products").select("id, workspace_id, archived_at").eq("id", productId.data).maybeSingle();
  if (!product || product.archived_at) return failure("Product not found.");
  try {
    await requireWorkspaceRole(product.workspace_id as string, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }

  const { plan } = await getWorkspacePlan(product.workspace_id as string);
  const mode = String(formData.get("mode") ?? "");
  const launchDate = String(formData.get("launchDate") ?? "") || null;
  const range = resolveHistoryRange({
    mode, launchDate, customStart: String(formData.get("customStart") ?? "") || null,
    now: new Date(), planHistoryDays: plan.historyDays, planName: plan.name,
  });
  if (!range.ok) return { status: "error", message: range.error, fields: { [range.field]: range.error } };

  const { count } = await supabase.from("monitoring_queries").select("id", { count: "exact", head: true })
    .eq("product_id", product.id).eq("enabled", true);
  if (!count) return failure("Add at least one active keyword before searching.");

  const admin = createAdminClient();
  try {
    if (mode === "launch" && launchDate) await admin.from("products").update({ launch_date: launchDate }).eq("id", product.id);
    const { existing } = await startBackfill(admin, {
      productId: product.id as string, workspaceId: product.workspace_id as string, userId: user.id,
      mode: range.mode, start: range.start, end: range.end,
    });
    if (existing) return failure("A historical search is already running for this product.");
  } catch (e) {
    logServerError("startHistoricalSearch", e);
    return failure("Couldn't start the historical search. Try again.");
  }

  // First batch now; the scheduler (every tick) continues whatever remains.
  after(async () => {
    try {
      await runWorker({ budgetMs: 55_000 });
    } catch (e) {
      logServerError("historyWorker", e);
    }
  });
  revalidatePath("/", "layout");
  return { status: "success", message: "Historical search started." };
}
