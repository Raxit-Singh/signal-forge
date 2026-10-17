"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";

const payload = z.object({
  workspaceId: z.uuid(),
  clusterId: z.uuid(),
  status: z.enum(["open", "acknowledged", "resolved", "dismissed"]),
});

/** Team decision on an issue. Runs as the user (RLS: members may change status only). */
export async function setClusterStatusAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = payload.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  try {
    await requireWorkspaceRole(parsed.data.workspaceId, "member");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("feedback_clusters").update({ status: parsed.data.status })
    .eq("id", parsed.data.clusterId).eq("workspace_id", parsed.data.workspaceId).select("id");
  if (error || !data?.length) {
    if (error) logServerError("clusterStatus", error);
    return failure("Couldn't update the issue.");
  }
  revalidatePath("/feedback");
  return { status: "success", message: "Updated." };
}
