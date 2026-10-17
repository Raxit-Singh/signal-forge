"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidSchema } from "@/lib/validation/schemas";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";
import { generateReport } from "@/lib/server/reports/generate";

/** A report for the last 7 days up to the current hour (computed from stored data; no API or AI calls). */
export async function generateReportNowAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const productId = uuidSchema.safeParse(formData.get("productId"));
  if (!productId.success) return failure("Invalid product.");
  const supabase = await createClient();
  const { data: p } = await supabase.from("products").select("id, workspace_id, competitor_of").eq("id", productId.data).maybeSingle();
  if (!p || p.competitor_of) return failure("Product not found.");
  try {
    await requireWorkspaceRole(p.workspace_id as string, "member");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const end = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
  const start = new Date(end.getTime() - 7 * 86_400_000);
  let id: string;
  try {
    const r = await generateReport(createAdminClient(), p.id as string, "custom", { start, end });
    if (!r) return failure("Nothing was monitored in the last 7 days, so there's nothing to report yet.");
    id = r.id;
  } catch (e) {
    logServerError("generateReport", e);
    return failure("Couldn't generate the report. Try again in a moment.");
  }
  revalidatePath("/reports");
  redirect(`/reports/${id}`);
}
