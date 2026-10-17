import { NextResponse, type NextRequest } from "next/server";
import { installUrl } from "@/lib/agent/github-app";
import { signState } from "@/lib/agent/signed-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { githubAppConfig } from "@/lib/server/agent/tasks";
import { stateSecret } from "@/lib/server/agent/state-secret";
import { requireWorkspaceRole } from "@/lib/server/session";

// Starts the GitHub App installation for a product's repository (workspace admins only).
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(new URL(`/settings/agent?${q}`, req.url));
  const productId = req.nextUrl.searchParams.get("product") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(productId)) return back("github=invalid");
  const app = githubAppConfig();
  if (!app) return back("github=not_configured");
  const { data: p } = await createAdminClient().from("products").select("workspace_id").eq("id", productId).maybeSingle();
  if (!p) return back("github=invalid");
  let userId: string;
  try {
    userId = (await requireWorkspaceRole(p.workspace_id as string, "admin")).user.id;
  } catch {
    return back("github=forbidden");
  }
  return NextResponse.redirect(installUrl(app.slug, signState(stateSecret(), { w: p.workspace_id as string, u: userId, p: productId })));
}
