"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";

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
