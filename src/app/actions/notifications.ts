"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation/schemas";
import { requireWorkspaceRole } from "@/lib/server/session";

export async function markNotificationsReadAction(formData: FormData): Promise<void> {
  const ws = uuidSchema.safeParse(formData.get("workspaceId"));
  if (!ws.success) return;
  await requireWorkspaceRole(ws.data, "viewer");
  const supabase = await createClient();
  // RLS limits this to the user's own + workspace-wide notifications.
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("workspace_id", ws.data)
    .is("read_at", null);
  revalidatePath("/", "layout");
}
