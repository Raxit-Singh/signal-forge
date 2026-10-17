"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";
import { connectGooglePlay, disconnect, setDiscordChannels } from "@/lib/server/collection/manage-connections";
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
    revalidatePath("/integrations");
    return { status: "success", message: r.checkedApp ? `Connected as ${r.account}; it can read reviews of ${r.checkedApp}.` : `Connected as ${r.account}. Add a Google Play URL to a product to start collecting its reviews.` };
  } catch (e) {
    if (e instanceof SourceError) return failure(e.message);
    logServerError("connectGooglePlay", e);
    return failure("Couldn't connect Google Play. Try again.");
  }
}

const disconnectSchema = z.object({ workspaceId: z.uuid(), provider: z.enum(["google_play", "discord"]), productId: z.uuid().optional().or(z.literal("")) });

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
  revalidatePath("/integrations");
  return { status: "success", message: parsed.data.provider === "discord" ? "Discord disconnected. Remove the bot from your server in Discord to revoke its access completely." : "Google Play disconnected and its key deleted. You can also delete the key in Google Cloud." };
}

const channelsSchema = z.object({ workspaceId: z.uuid(), productId: z.uuid(), mode: z.enum(["all", "keywords"]) });

export async function saveDiscordChannelsAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = channelsSchema.safeParse({ workspaceId: formData.get("workspaceId"), productId: formData.get("productId"), mode: formData.get("mode") });
  if (!parsed.success) return failure("Invalid request.");
  const channels = formData.getAll("channel").map(String).filter((c) => /^\d{15,22}$/.test(c));
  const a = await admin(parsed.data.workspaceId);
  if ("error" in a) return a.error!;
  try {
    const n = await setDiscordChannels(createAdminClient(), parsed.data.workspaceId, parsed.data.productId, channels, parsed.data.mode);
    revalidatePath("/integrations");
    return { status: "success", message: n ? `Reading ${n} channel${n === 1 ? "" : "s"}.` : "No channels chosen: nothing is read until you choose some." };
  } catch (e) {
    if (e instanceof SourceError) return failure(e.message);
    logServerError("saveDiscordChannels", e);
    return failure("Couldn't save the channels.");
  }
}
