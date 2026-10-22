import { SCOPES, wwwAuthenticate } from "@/lib/agent/oauth";
import { channelMessage } from "@/lib/agent/tasks";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAccessToken } from "@/lib/server/agent/oauth-store";
import { agentQueue } from "@/lib/server/agent/tasks";
import { json, site } from "@/lib/server/agent/http";

// Tasks waiting for the user's own Claude Code session. Polled by the SignalForge
// channel (channel/signalforge-channel.mjs) with the same OAuth tokens as the MCP
// server; scoped to the token's workspace. Read-only: the task starts when Claude
// calls get_agent_task.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  const admin = createAdminClient();
  const who = token ? await validateAccessToken(admin, token) : null;
  if (!who) return json({ error: "invalid_token" }, 401, { "www-authenticate": wwwAuthenticate(site(), token ? "invalid_token" : undefined) });
  if (!who.scopes.includes(SCOPES.agent)) return json({ error: "insufficient_scope" }, 403, { "www-authenticate": wwwAuthenticate(site(), "insufficient_scope") });
  const tasks = await agentQueue(admin, who);
  return json({ tasks: tasks.map((t) => ({ ...t, message: channelMessage(t) })) });
}
