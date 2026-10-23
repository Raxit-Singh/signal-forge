import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import { readiness } from "@/lib/server/agent/tasks";
import { CLAUDE_STATE_LABEL, claudeState, publiclyReachable, type ClaudeState } from "@/lib/agent/connection-state";
import { CLAUDE_CONNECTORS_URL, ConnectClaude } from "@/components/agent/connect-claude";
import { site } from "@/lib/server/agent/http";
import { resourceUrl } from "@/lib/agent/oauth";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ai/action-form";
import { CopyBlock } from "@/components/agent/copy-block";
import { disconnectClaudeAction, revokeClaudeAccessAction } from "@/app/actions/agent";
import { formatTime } from "@/lib/format";
import { getTimeZone } from "@/lib/server/timezone";

export const metadata: Metadata = { title: "Claude" };

const TONE: Record<ClaudeState, "positive" | "warning" | "negative" | "neutral" | "info"> = {
  not_connected: "neutral", connecting: "info", connected: "positive", needs_attention: "warning", unavailable: "neutral",
};

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex flex-wrap justify-between gap-2 py-1"><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>;
}

export default async function AgentSettings() {
  const tz = await getTimeZone();
  const at = (d: string | Date) => formatTime(d, tz);
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  const admin = createAdminClient();
  const supabase = await createClient();
  const isAdmin = hasRole(workspace.role, "admin");
  const r = await readiness(admin, workspace.id, product?.id ?? null);
  const mcp = resourceUrl(site());
  const publicSite = publiclyReachable(site());
  // A development server isn't reachable by Claude's apps, but Claude Code on the same computer can connect to it.
  const reachable = publicSite || process.env.NODE_ENV !== "production";
  const state = claudeState({ authorized: r.mcp.authorized, used: r.mcp.used, routineError: null, reachable });
  const claudeOn = state === "connected" || state === "needs_attention";

  const { data: grants } = isAdmin
    ? await supabase.from("oauth_grants").select("id, client_id, user_id, scopes, created_at, last_used_at").eq("workspace_id", workspace.id).is("revoked_at", null).order("created_at", { ascending: false })
    : { data: [] };
  const clientIds = [...new Set((grants ?? []).map((g) => g.client_id as string))];
  const { data: clients } = clientIds.length ? await admin.from("oauth_clients").select("client_id, client_name").in("client_id", clientIds) : { data: [] };
  const clientName = new Map((clients ?? []).map((c) => [c.client_id as string, c.client_name as string]));

  return (
    <div className="grid gap-4">
      <Card data-testid="claude-card">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Claude
            <Badge tone={TONE[state]} data-testid="claude-state">{CLAUDE_STATE_LABEL[state]}</Badge>
          </CardTitle>
          <CardDescription>
            Optional. “Investigate with Claude” on an issue works without this. Connected, Claude can also read every report on an issue,
            your products and spikes by itself, on your own Claude plan. Read-only: Claude can&apos;t change anything in SignalForge.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-[13px]">
          {state === "unavailable" && (
            <p className="text-muted-foreground">
              Claude can&apos;t reach this SignalForge server yet: it needs a public HTTPS address. Claude Code on this computer can still connect — see below.
            </p>
          )}
          {!publicSite && state !== "unavailable" && !claudeOn && (
            <p className="text-xs text-muted-foreground">Development server: Claude&apos;s apps can&apos;t reach {site()}, so connect with Claude Code on this computer (see “Having trouble connecting?”).</p>
          )}
          {state === "connecting" && <p className="text-muted-foreground">You approved access. Waiting for Claude to connect — this page updates on its own.</p>}
          {claudeOn && r.mcp.lastUsedAt && <p className="text-xs text-muted-foreground">Last used {at(r.mcp.lastUsedAt)}.</p>}

          <div className="flex flex-wrap items-center gap-2">
            {!claudeOn && state !== "unavailable" && <ConnectClaude address={mcp} state={state} />}
            {(claudeOn || state === "connecting") && isAdmin && (
              <a href="#manage" className="inline-flex h-8 items-center rounded-md border px-3 text-[13px] hover:bg-muted">Manage connection</a>
            )}
            {(claudeOn || state === "connecting") && isAdmin && (
              <ActionForm action={disconnectClaudeAction} fields={{ workspaceId: workspace.id }} label="Disconnect" variant="ghost" />
            )}
          </div>

          <details className="rounded-md border p-3 text-xs" data-testid="claude-fallback">
            <summary className="cursor-pointer text-[13px] font-medium">Having trouble connecting?</summary>
            <div className="mt-3 grid gap-3">
              <CopyBlock label="Connector URL (MCP)" text={mcp} />
              <ul className="grid list-disc gap-1 pl-4 text-muted-foreground">
                <li>In Claude: <a className="underline underline-offset-2" href={CLAUDE_CONNECTORS_URL} target="_blank" rel="noreferrer noopener">Customize → Connectors</a> → Add → Custom connector, paste the URL. Leave the advanced OAuth settings empty.</li>
                <li>Team and Enterprise plans: an owner first adds the connector for the organization; then each member connects it.</li>
                <li>Free Claude plans can add one custom connector.</li>
                <li>Claude Code: <code className="font-mono">claude mcp add --transport http signalforge {mcp}</code>, then run <code className="font-mono">/mcp</code> to sign in.</li>
                <li>Claude apps connect from Anthropic&apos;s cloud, so SignalForge must be at a public HTTPS address{publicSite ? " (it is)" : " (this server isn't)"}.</li>
              </ul>
            </div>
          </details>
        </CardContent>
      </Card>

      {isAdmin && (claudeOn || state === "connecting" || (grants ?? []).length > 0) && (
        <Card id="manage">
          <CardHeader>
            <CardTitle>Manage connection</CardTitle>
            <CardDescription>Each Claude account that was approved for this workspace. Revoking stops it at once.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-[13px]">
            <ul className="divide-y rounded-md border text-xs" aria-label="Claude connections">
              {(grants ?? []).map((g) => (
                <li key={g.id as string} className="flex flex-wrap items-center gap-2 p-2">
                  <span className="font-medium">{clientName.get(g.client_id as string) ?? "Claude"}</span>
                  <span className="text-muted-foreground">approved {at(g.created_at as string)} · {g.last_used_at ? `last used ${at(g.last_used_at as string)}` : "not used yet"}</span>
                  <ActionForm action={revokeClaudeAccessAction} fields={{ workspaceId: workspace.id, grantId: g.id as string }} label="Revoke" variant="ghost" className="ml-auto" />
                </li>
              ))}
            </ul>
            <dl className="divide-y text-xs" aria-label="Connection details" data-testid="agent-readiness">
              <Detail label="Claude access approved" value={r.mcp.authorized ? "Yes" : "No"} />
              <Detail label="Claude has connected" value={r.mcp.used ? `Yes · ${at(r.mcp.lastUsedAt!)}` : "Not yet"} />
            </dl>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
