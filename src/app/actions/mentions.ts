"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
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
    .from("mentions").select("id, workspace_id, relevance_score").eq("id", mentionId).maybeSingle();
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
  revalidatePath("/mentions");
  return { status: "success" };
}
