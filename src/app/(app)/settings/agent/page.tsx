import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import { githubAppConfig, readiness } from "@/lib/server/agent/tasks";
import { CLAUDE_STATE_LABEL, claudeState, publiclyReachable, type ClaudeState } from "@/lib/agent/connection-state";
import { CLAUDE_CONNECTORS_URL, ConnectClaude } from "@/components/agent/connect-claude";
import { site } from "@/lib/server/agent/http";
import { installationToken, listInstallationRepos, type RepoInfo } from "@/lib/agent/github-app";
import { resourceUrl } from "@/lib/agent/oauth";
import { ROUTINE_PROMPT, STATUS_LABEL, type TaskStatus } from "@/lib/agent/tasks";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/components/ai/action-form";
import { CopyBlock } from "@/components/agent/copy-block";
import { RoutineForm } from "@/components/agent/routine-form";
import { disconnectClaudeAction, removeRepositoryAction, removeRoutineAction, revokeClaudeAccessAction, selectRepositoryAction } from "@/app/actions/agent";
import { formatTime } from "@/lib/format";
import { getTimeZone } from "@/lib/server/timezone";

export const metadata: Metadata = { title: "Claude" };

const TONE: Record<ClaudeState, "positive" | "warning" | "negative" | "neutral" | "info"> = {
  not_connected: "neutral", connecting: "info", connected: "positive", needs_attention: "warning", unavailable: "neutral",
};

const GITHUB_MSG: Record<string, string> = {
  installed: "GitHub access granted. Choose the repository below.",
  not_configured: "Repository connection isn't available yet.",
  unverified: "GitHub didn't confirm you can access that installation, so it wasn't linked.",
  forbidden: "Only workspace admins can connect repositories.",
  failed: "The GitHub connection didn't complete. Try again.",
  invalid: "Invalid request.",
};

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex flex-wrap justify-between gap-2 py-1"><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>;
}

export default async function AgentSettings({ searchParams }: { searchParams: Promise<{ github?: string }> }) {
  const tz = await getTimeZone();
  const at = (d: string | Date) => formatTime(d, tz);
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  const admin = createAdminClient();
  const supabase = await createClient();
  const isAdmin = hasRole(workspace.role, "admin");
  const sp = await searchParams;
  const r = await readiness(admin, workspace.id, product?.id ?? null);
  const mcp = resourceUrl(site());
  const app = githubAppConfig();
  const publicSite = publiclyReachable(site());
  // A development server isn't reachable by Claude's apps, but Claude Code on the same computer can connect to it.
  const reachable = publicSite || process.env.NODE_ENV !== "production";
  const state = claudeState({ authorized: r.mcp.authorized, used: r.mcp.used, routineError: r.routine.status === "error" ? r.routine.lastError ?? "The Claude Code routine stopped working." : null, reachable });
  const claudeOn = state === "connected" || state === "needs_attention";

  const [{ data: grants }, { data: installs }, { data: tasks }] = await Promise.all([
    isAdmin ? supabase.from("oauth_grants").select("id, client_id, user_id, scopes, created_at, last_used_at").eq("workspace_id", workspace.id).is("revoked_at", null).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    supabase.from("github_installations").select("installation_id, account_login").eq("workspace_id", workspace.id).is("revoked_at", null),
    supabase.from("agent_tasks").select("id, stage, status, execution, created_at, pr_url, cluster_id").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const clientIds = [...new Set((grants ?? []).map((g) => g.client_id as string))];
  const { data: clients } = clientIds.length ? await admin.from("oauth_clients").select("client_id, client_name").in("client_id", clientIds) : { data: [] };
  const clientName = new Map((clients ?? []).map((c) => [c.client_id as string, c.client_name as string]));

  // Repositories the App can access (only fetched when a product still needs one).
  let repos: Array<RepoInfo & { installationId: number }> = [];
  if (app && isAdmin && product && !r.repository) {
    for (const i of installs ?? []) {
      const token = await installationToken(app, i.installation_id as number);
      const list = token ? await listInstallationRepos(token) : null;
      repos = repos.concat((list ?? []).map((x) => ({ ...x, installationId: i.installation_id as number })));
    }
  }
  const routineLabel = !r.routine.saved ? "Not set up" : r.routine.status === "error" ? "Needs attention" : r.routine.status === "ready" ? "Working" : "Set up, not used yet";

  return (
    <div className="grid gap-4">
      <Card data-testid="claude-card">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Claude
            <Badge tone={TONE[state]} data-testid="claude-state">{CLAUDE_STATE_LABEL[state]}</Badge>
          </CardTitle>
          <CardDescription>
            Connect Claude to investigate bugs and feature requests discovered by SignalForge. Claude works on your own Claude plan, and
            changes code only after you approve a plan — SignalForge never merges or deploys.
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
          {state === "needs_attention" && r.routine.lastError && <p className="text-warning">{r.routine.lastError}</p>}
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

      <Card data-testid="github-card">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            GitHub repository
            <Badge tone={r.repository ? "positive" : "neutral"} data-testid="github-state">{r.repository ? "Connected" : !app ? "Unavailable" : "Not connected"}</Badge>
          </CardTitle>
          <CardDescription>
            Lets SignalForge link {product ? `${product.name}'s` : "your"} repository and check the pull requests Claude opens. Read-only: SignalForge can&apos;t push code.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-[13px]">
          {sp.github && GITHUB_MSG[sp.github] && <p className="rounded-md border p-2 text-xs" role="status">{GITHUB_MSG[sp.github]}</p>}
          {r.repository ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono">{r.repository.fullName}</span>
              <Badge tone="neutral">{r.repository.private ? "private" : "public"}</Badge>
              {isAdmin && product && <ActionForm action={removeRepositoryAction} fields={{ workspaceId: workspace.id, productId: product.id }} label="Disconnect" variant="ghost" className="ml-auto" />}
            </div>
          ) : !app ? (
            <p className="text-muted-foreground">Repository connection isn&apos;t available yet. Claude can still investigate using the repository you open in Claude Code.</p>
          ) : !product ? (
            <p className="text-muted-foreground">Add a product first.</p>
          ) : (
            <>
              {!claudeOn && <p className="text-xs text-muted-foreground">Connect Claude first, then connect the repository.</p>}
              {isAdmin ? <Button asChild size="sm" variant={claudeOn ? "default" : "secondary"} className="w-fit"><a href={`/api/github/install?product=${product.id}`}>Connect repository</a></Button>
                : <p className="text-muted-foreground">Ask a workspace admin to connect the repository.</p>}
              {repos.length > 0 && isAdmin && (
                <ul className="divide-y rounded-md border text-xs" aria-label="Repositories">
                  {repos.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center gap-2 p-2">
                      <span className="font-mono">{x.fullName}</span>
                      <ActionForm action={selectRepositoryAction} fields={{ workspaceId: workspace.id, productId: product.id, installationId: String(x.installationId), repoId: String(x.id) }} label="Use for this product" variant="ghost" className="ml-auto" />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card data-testid="routine-card">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Automatic investigations <span className="text-xs font-normal text-muted-foreground">optional</span>
            <Badge tone={r.routine.status === "error" ? "warning" : r.routine.status === "ready" ? "positive" : "neutral"} data-testid="routine-state">{routineLabel}</Badge>
          </CardTitle>
          <CardDescription>
            {r.routine.saved
              ? "“Investigate with Claude” starts a Claude Code session for you."
              : "Not set up: “Investigate with Claude” gives you a ready-made request to paste into Claude Code. Set this up to have SignalForge start Claude Code for you."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-[13px]">
          {r.routine.saved && isAdmin && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {r.routine.lastError && <span className="text-warning">{r.routine.lastError}</span>}
              <ActionForm action={removeRoutineAction} fields={{ workspaceId: workspace.id }} label="Remove" variant="ghost" className="ml-auto" />
            </div>
          )}
          {isAdmin && (
            <details className="rounded-md border p-3 text-xs">
              <summary className="cursor-pointer text-[13px] font-medium">{r.routine.saved ? "Replace the Claude Code routine" : "Set up automatic investigations"}</summary>
              <div className="mt-3 grid gap-3">
                <p className="text-muted-foreground">
                  Needs a Claude plan with Claude Code on the web (Pro, Max, Team or Enterprise); runs count against it. Claude doesn&apos;t let
                  other apps create routines for you, so this is done once in Claude:
                </p>
                <ol className="list-decimal pl-5 text-muted-foreground">
                  <li>At <a href="https://claude.ai/code/routines" target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">claude.ai/code/routines <ExternalLink className="inline size-3" aria-hidden /></a>, create a routine with your repository, the SignalForge connector, and the instructions below.</li>
                  <li>Add an <span className="font-medium">API</span> trigger, copy its URL and generate a token, and paste both here.</li>
                </ol>
                <CopyBlock label="Routine instructions" text={ROUTINE_PROMPT} />
                <RoutineForm workspaceId={workspace.id} saved={r.routine.saved} />
              </div>
            </details>
          )}
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
              <Detail label="Repository" value={r.repository ? r.repository.fullName : app ? "Not connected" : "Unavailable on this server"} />
              <Detail label="Automatic investigations" value={routineLabel} />
              <Detail label="Implementation" value="Only after you approve a plan; Claude opens a pull request for review" />
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Investigations and implementations</CardTitle>
          <CardDescription>Started from issues on the <Link href="/feedback" className="underline underline-offset-2">Feedback</Link> page.</CardDescription>
        </CardHeader>
        <CardContent>
          {(tasks ?? []).length === 0 ? <p className="text-[13px] text-muted-foreground">None yet.</p> : (
            <table className="w-full text-[13px]" data-testid="agent-tasks">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 font-medium">Started</th><th className="font-medium">Stage</th><th className="font-medium">Status</th><th className="font-medium">Result</th></tr></thead>
              <tbody>
                {(tasks ?? []).map((t) => (
                  <tr key={t.id as string} className="border-t">
                    <td className="py-1.5">{at(t.created_at as string)}</td>
                    <td className="capitalize">{t.stage as string}{t.execution === "manual" ? " (manual)" : ""}</td>
                    <td>{STATUS_LABEL[t.status as TaskStatus]}</td>
                    <td>{t.pr_url ? <a href={t.pr_url as string} className="underline underline-offset-2" target="_blank" rel="noreferrer noopener">Pull request</a> : <Link href={`/feedback#issue-${t.cluster_id}`} className="underline underline-offset-2">Issue</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
