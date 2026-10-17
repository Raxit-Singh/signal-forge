"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, uuidSchema } from "@/lib/validation/schemas";
import { failure, invalid, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, PRODUCT_COOKIE, WORKSPACE_COOKIE, requireWorkspaceRole } from "@/lib/server/session";
import { site } from "@/lib/server/agent/http";

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };
const ROLES = ["admin", "member", "viewer"] as const;

/** Only the hash of an invitation token is stored; the token itself is shown to the inviter once. */
const hashInviteToken = async (token: string) => createHash("sha256").update(token).digest("hex");

export type InviteState = ActionState | { status: "invited"; message: string; link: string; email: string };

const inviteSchema = z.object({ workspaceId: z.uuid(), email: emailSchema, role: z.enum(ROLES) });

export async function inviteMemberAction(_: InviteState, formData: FormData): Promise<InviteState> {
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  try {
    await requireWorkspaceRole(parsed.data.workspaceId, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const token = randomBytes(32).toString("base64url");
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_invitation", {
    p_workspace_id: parsed.data.workspaceId, p_email: parsed.data.email, p_role: parsed.data.role, p_token_hash: await hashInviteToken(token),
  });
  if (error) {
    if (error.code === "42501" || error.code === "23505") return failure(error.message);
    logServerError("invite", error);
    return failure("Couldn't create the invitation. Try again.");
  }
  revalidatePath("/settings/workspace");
  return {
    status: "invited", email: parsed.data.email, link: `${site()}/invite/${token}`,
    message: `Invitation for ${parsed.data.email} created. Copy the link and send it to them — it's shown only once and works for 7 days.`,
  };
}

const idPayload = z.object({ workspaceId: z.uuid(), invitationId: z.uuid() });

export async function revokeInvitationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = idPayload.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: parsed.data.invitationId });
  if (error) return failure(error.code === "42501" ? "Not allowed." : "Couldn't revoke the invitation.");
  revalidatePath("/settings/workspace");
  return { status: "success", message: "Invitation revoked: the link no longer works." };
}

const roleSchema = z.object({ workspaceId: z.uuid(), userId: z.uuid(), role: z.enum(["owner", ...ROLES]) });

export async function setMemberRoleAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = roleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", { p_workspace_id: parsed.data.workspaceId, p_user_id: parsed.data.userId, p_role: parsed.data.role });
  if (error) {
    if (error.code === "42501") return failure(error.message === "Member not found" ? "Not allowed." : error.message);
    if (error.message.includes("at least one owner")) return failure("The workspace needs at least one owner.");
    logServerError("setMemberRole", error);
    return failure("Couldn't change the role.");
  }
  revalidatePath("/settings/workspace");
  return { status: "success", message: "Role updated." };
}

const removeSchema = z.object({ workspaceId: z.uuid(), userId: z.uuid() });

export async function removeMemberAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = removeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.rpc("remove_member", { p_workspace_id: parsed.data.workspaceId, p_user_id: parsed.data.userId });
  if (error) {
    if (error.message.includes("at least one owner")) return failure("The workspace needs at least one owner. Make someone else an owner first.");
    if (error.code === "42501") return failure(error.message === "Member not found" ? "Not allowed." : error.message);
    logServerError("removeMember", error);
    return failure("Couldn't remove the member.");
  }
  if (user && parsed.data.userId === user.id) {
    const store = await cookies();
    store.delete(WORKSPACE_COOKIE);
    store.delete(PRODUCT_COOKIE);
    redirect("/overview");
  }
  revalidatePath("/settings/workspace");
  return { status: "success", message: "Member removed." };
}

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Joins the workspace the invitation is for (signed in as the invited address) and switches to it. */
export async function acceptInvitationAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const token = tokenSchema.safeParse(formData.get("token"));
  if (!token.success) return failure("This invitation link isn't valid.");
  const supabase = await createClient();
  const { data: ws, error } = await supabase.rpc("accept_invitation", { p_token_hash: await hashInviteToken(token.data) });
  if (error || !ws) {
    if (error?.code === "22023" || error?.code === "42501") return failure(error.message);
    logServerError("acceptInvitation", error);
    return failure("Couldn't accept the invitation. Try again.");
  }
  if (!uuidSchema.safeParse(ws).success) return failure("Couldn't accept the invitation.");
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, String(ws), COOKIE_OPTS);
  store.delete(PRODUCT_COOKIE);
  redirect("/overview");
}
