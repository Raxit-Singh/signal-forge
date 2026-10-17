import { NextResponse, type NextRequest } from "next/server";
import { verifyState } from "@/lib/agent/signed-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { stateSecret } from "@/lib/server/agent/state-secret";
import { site } from "@/lib/server/agent/http";
import { connectDiscord, exchangeDiscordCode } from "@/lib/server/collection/manage-connections";
import { getUser, requireWorkspaceRole } from "@/lib/server/session";
import { SourceError } from "@/lib/sources/errors";

// Discord returns here after the admin added the bot. The state proves who started
// it and for which product; the code exchange proves which server it was added to.
export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(new URL(`/integrations?${q}`, req.url));
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back("discord=cancelled");
  const code = sp.get("code") ?? "";
  const state = sp.get("state") ?? "";
  const user = await getUser();
  if (!user || !code) return back("discord=invalid");
  const s = verifyState(stateSecret(), state, user.id);
  if (!s?.p) return back("discord=expired");
  try {
    await requireWorkspaceRole(s.w, "admin");
  } catch {
    return back("discord=forbidden");
  }
  try {
    const guild = await exchangeDiscordCode(code, `${site()}/api/discord/callback`);
    await connectDiscord(createAdminClient(), s.w, s.p, user.id, guild);
  } catch (e) {
    console.error(`[discord] connect failed: ${e instanceof Error ? e.message : e}`);
    return back(e instanceof SourceError && e.kind === "auth" ? "discord=denied" : "discord=failed");
  }
  return back("discord=connected");
}
