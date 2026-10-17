import { NextResponse, type NextRequest } from "next/server";
import { exchangeUserCode, verifyUserInstallation } from "@/lib/agent/github-app";
import { verifyState } from "@/lib/agent/signed-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { githubAppConfig } from "@/lib/server/agent/tasks";
import { audit } from "@/lib/server/agent/oauth-store";
import { stateSecret } from "@/lib/server/agent/state-secret";
import { getUser, requireWorkspaceRole } from "@/lib/server/session";

// GitHub App setup callback. Links an installation to a workspace only when:
//   * the signed state matches the signed-in user who started the flow (CSRF), and
//   * that user can access the installation per GitHub (user-to-server token).
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(new URL(`/settings/agent?${q}`, req.url));
  const app = githubAppConfig();
  const user = await getUser();
  if (!app || !user) return back("github=failed");
  const sp = req.nextUrl.searchParams;
  const st = verifyState(stateSecret(), sp.get("state") ?? "", user.id);
  const installationId = Number(sp.get("installation_id"));
  const code = sp.get("code");
  if (!st || !Number.isSafeInteger(installationId) || installationId <= 0 || !code) return back("github=failed");
  try {
    await requireWorkspaceRole(st.w, "admin");
  } catch {
    return back("github=forbidden");
  }
  const userToken = await exchangeUserCode(app, code);
  const inst = userToken ? await verifyUserInstallation(userToken, installationId) : null;
  if (!inst) return back("github=unverified");
  const admin = createAdminClient();
  const { error } = await admin.from("github_installations").upsert({
    workspace_id: st.w, installation_id: inst.id, account_login: inst.account, repository_selection: inst.repositorySelection,
    permissions: inst.permissions, installed_by: user.id, revoked_at: null,
  }, { onConflict: "workspace_id,installation_id" });
  if (error) return back("github=failed");
  await audit(admin, st.w, user.id, "agent.github_installed", String(inst.id), { account: inst.account });
  return back(`github=installed${st.p ? `&product=${st.p}` : ""}`);
}
