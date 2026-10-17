"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { getUser, requireWorkspaceRole } from "@/lib/server/session";

const schema = z.object({ workspaceId: z.uuid(), weekly: z.enum(["on", "off"]) });

/** Your own weekly report emails for one workspace (RLS: only your own row). */
export async function setWeeklyEmailAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  const user = await getUser();
  if (!user) return failure("Your session has expired. Sign in again.");
  try {
    await requireWorkspaceRole(parsed.data.workspaceId, "viewer");
  } catch {
    return failure("Not allowed.");
  }
  const supabase = await createClient();
  const { error } = await supabase.from("notification_preferences").upsert(
    { workspace_id: parsed.data.workspaceId, user_id: user.id, channel: "email", weekly_report: parsed.data.weekly === "on", updated_at: new Date().toISOString() },
    { onConflict: "workspace_id,user_id,channel" },
  );
  if (error) {
    logServerError("setWeeklyEmail", error);
    return failure("Couldn't save.");
  }
  revalidatePath("/settings/account");
  return { status: "success", message: parsed.data.weekly === "on" ? "You'll get weekly report emails." : "Weekly report emails are off." };
}
