import { NextResponse, type NextRequest } from "next/server";
import { signState } from "@/lib/agent/signed-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { stateSecret } from "@/lib/server/agent/state-secret";
import { site } from "@/lib/server/agent/http";
import { discordConfig } from "@/lib/server/collection/manage-connections";
import { DISCORD_BOT_PERMISSIONS } from "@/lib/sources/discord";
import { requireWorkspaceRole } from "@/lib/server/session";

// Starts Discord's bot authorization for one product (workspace admins only).
// Discord asks the person which server to add the bot to and shows the two
// read-only permissions; the callback confirms the server through the code exchange.
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(new URL(`/integrations?${q}`, req.url));
  const productId = req.nextUrl.searchParams.get("product") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(productId)) return back("discord=invalid");
  const cfg = discordConfig();
  if (!cfg) return back("discord=not_configured");
  const { data: p } = await createAdminClient().from("products").select("workspace_id, competitor_of").eq("id", productId).maybeSingle();
  if (!p || p.competitor_of) return back("discord=invalid");
  let userId: string;
  try {
    userId = (await requireWorkspaceRole(p.workspace_id as string, "admin")).user.id;
  } catch {
    return back("discord=forbidden");
  }
  const q = new URLSearchParams({
    client_id: cfg.clientId, scope: "bot", permissions: DISCORD_BOT_PERMISSIONS, response_type: "code",
    redirect_uri: `${site()}/api/discord/callback`, state: signState(stateSecret(), { w: p.workspace_id as string, u: userId, p: productId }),
  });
  return NextResponse.redirect(`https://discord.com/oauth2/authorize?${q}`);
}
