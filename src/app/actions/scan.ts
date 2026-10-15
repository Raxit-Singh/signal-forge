"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidSchema } from "@/lib/validation/schemas";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, getUser, getWorkspacePlan, requireWorkspaceRole } from "@/lib/server/session";
import { configuredSourceIds } from "@/lib/server/collection/sources";
import { runWorker } from "@/lib/server/collection/worker";

/** Initial scans look back this far (bounded by the plan's history window). */
const INITIAL_LOOKBACK_DAYS = 30;
/** Manual re-scans only need to catch up recent activity. */
const MANUAL_LOOKBACK_DAYS = 3;
/** One manual scan per product per this many minutes (protects shared API quotas). */
const MANUAL_COOLDOWN_MINUTES = 30;

export async function startScanAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const productId = uuidSchema.safeParse(formData.get("productId"));
  const kind = formData.get("kind") === "manual" ? "manual" : "initial";
  if (!productId.success) return failure("Invalid product.");

  const user = await getUser();
  if (!user) return failure("Your session has expired. Sign in again.");
  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products").select("id, workspace_id, archived_at").eq("id", productId.data).maybeSingle();
  if (!product || product.archived_at) return failure("Product not found.");
  try {
    await requireWorkspaceRole(product.workspace_id as string, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }

  const { count: queries } = await supabase
    .from("monitoring_queries").select("id", { count: "exact", head: true })
    .eq("product_id", product.id).eq("enabled", true);
  if (!queries) return failure("Add at least one active keyword before scanning.");

  const providers = configuredSourceIds();
  if (providers.length === 0) return failure("No data sources are configured on this server.");

  if (kind === "manual") {
    const { data: recent } = await supabase
      .from("scans").select("created_at").eq("product_id", product.id)
      .gte("created_at", new Date(Date.now() - MANUAL_COOLDOWN_MINUTES * 60_000).toISOString())
      .limit(1).maybeSingle();
    if (recent) return failure(`A scan ran in the last ${MANUAL_COOLDOWN_MINUTES} minutes. Scheduled monitoring continues in the meantime.`);
  }

  const { plan } = await getWorkspacePlan(product.workspace_id as string);
  const lookback = Math.min(kind === "initial" ? INITIAL_LOOKBACK_DAYS : MANUAL_LOOKBACK_DAYS, plan.historyDays);

  const admin = createAdminClient();
  const { data: scanId, error } = await admin.rpc("svc_start_scan", {
    p_product_id: product.id, p_user_id: user.id, p_kind: kind, p_providers: providers, p_lookback_days: lookback,
  });
  if (error || !scanId) {
    logServerError("startScan", error ?? new Error("no scan id"));
    return failure("Couldn't start the scan. Try again.");
  }

  // Work this scan right away instead of waiting for the next scheduler tick.
  // If the function is cut short, the scheduler picks up the remaining jobs.
  after(async () => {
    try {
      await runWorker({ budgetMs: 55_000, scanId: String(scanId) });
    } catch (e) {
      logServerError("scanWorker", e);
    }
  });

  revalidatePath("/", "layout");
  return { status: "success", message: "Scan started." };
}
