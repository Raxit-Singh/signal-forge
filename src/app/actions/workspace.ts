"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { workspaceNameSchema, uuidSchema } from "@/lib/validation/schemas";
import { failure, invalid, logServerError, type ActionState } from "@/lib/server/action-result";
import {
  AuthorizationError, PRODUCT_COOKIE, WORKSPACE_COOKIE, getUser, requireWorkspaceRole,
} from "@/lib/server/session";

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };

export async function createWorkspaceAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return failure("Your session has expired. Sign in again.");
  const parsed = workspaceNameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_workspace", { p_name: parsed.data.name });
  if (error) {
    if (error.hint === "limit:workspaces") return failure("You can own up to 5 workspaces.");
    logServerError("createWorkspace", error);
    return failure("Couldn't create the workspace. Try again.");
  }
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, String(data), COOKIE_OPTS);
  store.delete(PRODUCT_COOKIE);
  redirect("/onboarding/product");
}

export async function switchWorkspaceAction(formData: FormData): Promise<void> {
  const id = uuidSchema.safeParse(formData.get("workspaceId"));
  if (!id.success) redirect("/overview");
  try {
    await requireWorkspaceRole(id.data, "viewer");
  } catch {
    redirect("/overview");
  }
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, id.data, COOKIE_OPTS);
  store.delete(PRODUCT_COOKIE);
  redirect("/overview");
}

export async function switchProductAction(formData: FormData): Promise<void> {
  const id = uuidSchema.safeParse(formData.get("productId"));
  const back = z.string().regex(/^\/[a-z-]*$/).catch("/overview").parse(formData.get("returnTo") ?? "/overview");
  if (id.success) {
    // RLS: the lookup only succeeds for products in workspaces the user belongs to.
    const supabase = await createClient();
    const { data } = await supabase.from("products").select("id").eq("id", id.data).maybeSingle();
    if (data) (await cookies()).set(PRODUCT_COOKIE, id.data, COOKIE_OPTS);
  }
  redirect(back || "/overview");
}

export async function renameWorkspaceAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const id = uuidSchema.safeParse(formData.get("workspaceId"));
  const parsed = workspaceNameSchema.safeParse({ name: formData.get("name") });
  if (!id.success) return failure("Invalid workspace.");
  if (!parsed.success) return invalid(parsed.error);
  try {
    await requireWorkspaceRole(id.data, "admin");
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  const supabase = await createClient();
  const { error } = await supabase.from("workspaces").update({ name: parsed.data.name }).eq("id", id.data);
  if (error) {
    logServerError("renameWorkspace", error);
    return failure("Couldn't rename the workspace.");
  }
  revalidatePath("/", "layout");
  return { status: "success", message: "Workspace renamed." };
}

export async function deleteWorkspaceAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const id = uuidSchema.safeParse(formData.get("workspaceId"));
  if (!id.success) return failure("Invalid workspace.");
  let wsName: string;
  try {
    wsName = (await requireWorkspaceRole(id.data, "owner")).workspace.name;
  } catch (e) {
    return failure(e instanceof AuthorizationError ? e.message : "Not allowed.");
  }
  if (String(formData.get("confirm") ?? "").trim() !== wsName) {
    return { status: "error", message: "Type the workspace name exactly to confirm.", fields: { confirm: "Doesn't match." } };
  }
  const supabase = await createClient();
  const { error, count } = await supabase.from("workspaces").delete({ count: "exact" }).eq("id", id.data);
  if (error) {
    if (error.hint === "billing_active") return failure("Cancel the paid subscription before deleting this workspace.");
    logServerError("deleteWorkspace", error);
    return failure("Couldn't delete the workspace.");
  }
  if (!count) return failure("Workspace not found.");
  const store = await cookies();
  store.delete(WORKSPACE_COOKIE);
  store.delete(PRODUCT_COOKIE);
  redirect("/overview");
}
