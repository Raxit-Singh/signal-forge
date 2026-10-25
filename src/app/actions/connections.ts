"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";
import { connectGooglePlay, disconnect } from "@/lib/server/collection/manage-connections";
import { SourceError } from "@/lib/sources/errors";

async function admin(workspaceId: string) {
  try {
    return { userId: (await requireWorkspaceRole(workspaceId, "admin")).user.id };
  } catch (e) {
    return { error: failure(e instanceof AuthorizationError ? e.message : "Not allowed.") };
  }
}

const playSchema = z.object({ workspaceId: z.uuid(), key: z.string().min(50).max(20_000) });

/** Stores a Google Play service-account key after proving it works (never echoed back). */
export async function connectGooglePlayAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = playSchema.safeParse({ workspaceId: formData.get("workspaceId"), key: formData.get("key") });
  if (!parsed.success) return failure("Paste the whole JSON key file.");
  const a = await admin(parsed.data.workspaceId);
  if ("error" in a) return a.error!;
  try {
    const r = await connectGooglePlay(createAdminClient(), parsed.data.workspaceId, a.userId, parsed.data.key);
    revalidatePath("/settings/connections");
    return { status: "success", message: r.checkedApp ? `Connected as ${r.account}; it can read reviews of ${r.checkedApp}.` : `Connected as ${r.account}. Add a Google Play URL to a product to start collecting its reviews.` };
  } catch (e) {
    if (e instanceof SourceError) return failure(e.message);
    logServerError("connectGooglePlay", e);
    return failure("Couldn't connect Google Play. Try again.");
  }
}

const disconnectSchema = z.object({ workspaceId: z.uuid(), provider: z.enum(["google_play"]), productId: z.uuid().optional().or(z.literal("")) });

export async function disconnectSourceAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = disconnectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  const a = await admin(parsed.data.workspaceId);
  if ("error" in a) return a.error!;
  try {
    await disconnect(createAdminClient(), parsed.data.workspaceId, parsed.data.provider, parsed.data.productId || null);
  } catch (e) {
    logServerError("disconnect", e);
    return failure("Couldn't disconnect. Try again.");
  }
  revalidatePath("/settings/connections");
  return { status: "success", message: "Google Play disconnected and its key deleted. You can also delete the key in Google Cloud." };
}

