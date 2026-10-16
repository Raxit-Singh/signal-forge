"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { getUser } from "@/lib/server/session";

const payload = z.object({
  mentionId: z.uuid(),
  value: z.enum(["relevant", "irrelevant", "reset"]),
});

/**
 * Manual relevance correction. Authorization is RLS (`mentions_correct`:
 * members and above); viewers' updates match no rows. The decision is kept
 * forever: re-ingestion never overwrites `user_*` statuses, and every
 * correction is recorded as a manual classification for later learning.
 */
export async function setMentionRelevanceAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = payload.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  const user = await getUser();
  if (!user) return failure("Your session has expired. Sign in again.");
  const { mentionId, value } = parsed.data;

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("mentions").select("id, workspace_id, product_id, relevance_score").eq("id", mentionId).maybeSingle();
  if (!current) return failure("Mention not found.");

  // "reset" hands the decision back to the rules, using the score they produced.
  const status =
    value === "relevant" ? "user_relevant"
    : value === "irrelevant" ? "user_irrelevant"
    : (current.relevance_score ?? 0) >= 0.75 ? "relevant" : "pending";

  const { data: updated, error } = await supabase
    .from("mentions").update({ relevance_status: status }).eq("id", mentionId).select("id");
  if (error) {
    logServerError("setMentionRelevance", error);
    return failure("Couldn't save your choice.");
  }
  if (!updated?.length) return failure("You don't have permission to change mentions in this workspace.");

  if (value !== "reset") {
    const { error: cErr } = await supabase.from("mention_classifications").insert({
      workspace_id: current.workspace_id, mention_id: mentionId, dimension: "relevance",
      label: value, confidence: 1, classifier: "manual", created_by: user.id,
    });
    if (cErr) logServerError("setMentionRelevance.history", cErr);
  }
  // Other members' open pages refresh too (a signal only; they re-read through RLS).
  const { error: evErr } = await createAdminClient().rpc("svc_emit_workspace_event", {
    p_workspace_id: current.workspace_id, p_product_id: current.product_id, p_kind: "mentions", p_payload: { relevance: 1 },
  });
  if (evErr) logServerError("setMentionRelevance.event", evErr);
  revalidatePath("/mentions");
  return { status: "success" };
}

const sincePayload = z.object({ productId: z.uuid(), since: z.iso.datetime({ offset: true }) });

/**
 * Mentions (in the default view: relevant + needs review, originals) stored after
 * `since` — for the "new mentions found" notice on older pages. Read through RLS.
 */
export async function countNewMentionsAction(productId: string, since: string): Promise<number> {
  const parsed = sincePayload.safeParse({ productId, since });
  if (!parsed.success) return 0;
  const supabase = await createClient();
  const { count } = await supabase.from("mentions").select("id", { count: "exact", head: true })
    .eq("product_id", parsed.data.productId).gt("discovered_at", parsed.data.since)
    .eq("dedup_kind", "original").in("relevance_status", ["relevant", "pending", "user_relevant"]);
  return count ?? 0;
}
