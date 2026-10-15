"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { getUser, PRODUCT_COOKIE, WORKSPACE_COOKIE } from "@/lib/server/session";

/**
 * Permanently deletes the signed-in user's account:
 *   1. Workspaces they solely own are deleted (with all data, via cascades).
 *      If such a workspace has other members, deletion stops: transfer first.
 *   2. Memberships in other workspaces are removed.
 *   3. The auth user is deleted (profile cascades).
 * Paid workspaces must be canceled first (enforced by a DB trigger).
 */
export async function deleteAccountAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return failure("Your session has expired. Sign in again.");
  if (String(formData.get("confirm") ?? "") !== "DELETE") {
    return { status: "error", message: "Type DELETE to confirm.", fields: { confirm: "Type DELETE" } };
  }

  const admin = createAdminClient();
  const { error: prepError } = await admin.rpc("svc_prepare_account_deletion", { p_user_id: user.id });
  if (prepError) {
    if (prepError.hint === "transfer_ownership") {
      return failure("You're the only owner of a workspace that has other members. Transfer ownership or remove them first.");
    }
    if (prepError.hint === "billing_active") {
      return failure("Cancel your paid subscription before deleting your account.");
    }
    logServerError("deleteAccount.prepare", prepError);
    return failure("Couldn't delete your account. Nothing was removed.");
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    logServerError("deleteAccount.auth", error);
    return failure("Your workspaces were removed, but deleting the login failed. Contact support.");
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  const store = await cookies();
  store.delete(WORKSPACE_COOKIE);
  store.delete(PRODUCT_COOKIE);
  redirect("/login?notice=account_deleted");
}
