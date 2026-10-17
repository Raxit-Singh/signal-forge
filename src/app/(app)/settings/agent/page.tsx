import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import { githubAppConfig, readiness, type ReadinessState } from "@/lib/server/agent/tasks";
import { site } from "@/lib/server/agent/http";
import { installationToken, listInstallationRepos, type RepoInfo } from "@/lib/agent/github-app";
import { resourceUrl } from "@/lib/agent/oauth";
import { ROUTINE_PROMPT, STATUS_LABEL, type TaskStatus } from "@/lib/agent/tasks";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/components/ai/action-form";
import { CopyBlock } from "@/components/agent/copy-block";
import { RoutineForm } from "@/components/agent/routine-form";
import { removeRepositoryAction, removeRoutineAction, revokeClaudeAccessAction, selectRepositoryAction } from "@/app/actions/agent";
import { formatUtc } from "@/lib/format";

export const metadata: Metadata = { title: "Developer agent" };

const STATE: Record<ReadinessState, { label: string; tone: "positive" | "warning" | "negative" | "neutral" | "info" }> = {
  not_connected: { label: "Not connected", tone: "neutral" },
  setup_required: { label: "Setup required", tone: "warning" },
  mcp_connected: { label: "Connected to SignalForge MCP", tone: "info" },
  repository_required: { label: "Repository access required", tone: "warning" },
  execution_unavailable: { label: "Coding-agent execution unavailable — manual handoff", tone: "warning" },
  ready: { label: "Ready for investigation", tone: "positive" },
  error: { label: "Error", tone: "negative" },
};

const GITHUB_MSG: Record<string, string> = {
  installed: "GitHub App installed. Choose the repository below.",
  not_configured: "The SignalForge GitHub App isn't configured on this server yet.",
  unverified: "GitHub didn't confirm you can access that installation, so it wasn't linked.",
  forbidden: "Only workspace admins can connect repositories.",
  failed: "The GitHub connection didn't complete. Try again.",
  invalid: "Invalid request.",
};

function Step({ done, title, children }: { done: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.25rem_1fr] gap-2">
      {done ? <CheckCircle2 className="mt-0.5 size-4 text-positive" aria-label="Done" /> : <Circle className="mt-0.5 size-4 text-muted-foreground" aria-label="Not done" />}
      <div className="grid gap-2"><span className="font-medium">{title}</span>{children}</div>
    </li>
  );
}

export default async function AgentSettings({ searchParams }: { searchParams: Promise<{ github?: string }> }) {
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  const admin = createAdminClient();
  const supabase = await createClient();
  const isAdmin = hasRole(workspace.role, "admin");
  const sp = await searchParams;
  const r = await readiness(admin, workspace.id, product?.id ?? null);
  const mcp = resourceUrl(site());
  const app = githubAppConfig();

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

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Developer agent (Claude)</CardTitle>
          <CardDescription>
            Lets your own Claude read SignalForge&apos;s issues for this workspace, investigate them in your codebase, and —
            only after you approve a specific plan — implement it and open a pull request for review. It runs on your Claude
            subscription, never on SignalForge&apos;s AI, and SignalForge never merges or deploys anything.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-2" data-testid="agent-readiness">
            <span className="font-medium">Status</span>
            <Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge>
            {r.routine.lastError && <span className="text-xs text-negative">{r.routine.lastError}</span>}
          </div>
          {sp.github && GITHUB_MSG[sp.github] && <p className="rounded-md border p-2 text-xs" role="status">{GITHUB_MSG[sp.github]}</p>}

          <ol className="grid gap-5">
            <Step done={r.mcp.used} title="1. Connect Claude to SignalForge">
              <p className="text-muted-foreground">
                In Claude, add SignalForge as a custom connector with this URL, then sign in to SignalForge and approve when asked.
                Claude chooses this connection itself; SignalForge never asks for your Claude password.
              </p>
              <CopyBlock label="Connector URL" text={mcp} />
              <p className="text-xs text-muted-foreground">
                claude.ai or the Claude apps: Settings → Connectors → Add custom connector. Claude Code:{" "}
                <code className="font-mono">claude mcp add --transport http signalforge {mcp}</code>
              </p>
              <p className="text-xs text-muted-foreground" data-testid="mcp-state">
                {r.mcp.used ? `Connected — last used ${formatUtc(r.mcp.lastUsedAt!)}.` : r.mcp.authorized ? "Authorized, but Claude hasn't called SignalForge yet." : "Not connected yet."}
              </p>
              {isAdmin && (grants ?? []).length > 0 && (
                <ul className="divide-y rounded-md border text-xs" aria-label="Claude connections">
                  {(grants ?? []).map((g) => (
                    <li key={g.id as string} className="flex flex-wrap items-center gap-2 p-2">
                      <span className="font-medium">{clientName.get(g.client_id as string) ?? "Claude"}</span>
                      <span className="text-muted-foreground">authorized {formatUtc(g.created_at as string)} · {g.last_used_at ? `last used ${formatUtc(g.last_used_at as string)}` : "not used yet"}</span>
                      <ActionForm action={revokeClaudeAccessAction} fields={{ workspaceId: workspace.id, grantId: g.id as string }} label="Revoke" variant="ghost" className="ml-auto" />
                    </li>
                  ))}
                </ul>
              )}
            </Step>

            <Step done={!!r.repository} title={`2. Authorize ${product ? `${product.name}'s` : "your"} GitHub repository`}>
              {r.repository ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono">{r.repository.fullName}</span>
                  <Badge tone="neutral">{r.repository.private ? "private" : "public"}</Badge>
                  <span className="text-muted-foreground">default branch {r.repository.defaultBranch}</span>
                  {isAdmin && product && <ActionForm action={removeRepositoryAction} fields={{ workspaceId: workspace.id, productId: product.id }} label="Unlink" variant="ghost" className="ml-auto" />}
                </div>
              ) : !app ? (
                <p className="text-muted-foreground">The SignalForge GitHub App isn&apos;t configured on this server yet, so repositories can&apos;t be linked.</p>
              ) : !product ? (
                <p className="text-muted-foreground">Add a product first.</p>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    Install the SignalForge GitHub App on the repository (read-only: metadata, code and pull requests). SignalForge uses it
                    to link the repository and to check the pull requests Claude reports; it can&apos;t push code.
                  </p>
                  {isAdmin && <Button asChild variant="secondary" size="sm" className="w-fit"><a href={`/api/github/install?product=${product.id}`}>Install GitHub App</a></Button>}
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
              <p className="text-xs text-muted-foreground">Claude itself works in the repository through your own Claude GitHub connection, which you set up in Claude Code.</p>
            </Step>

            <Step done={r.routine.saved} title="3. Let SignalForge start Claude Code (optional)">
              <p className="text-muted-foreground">
                With a Claude Code routine, “Investigate with Claude” starts a cloud session for you. Without one, SignalForge gives
                you a request to paste into Claude Code yourself. Routines need a Claude Pro, Max, Team or Enterprise plan with Claude
                Code on the web; runs count against that subscription.
              </p>
              <ol className="list-decimal pl-5 text-xs text-muted-foreground">
                <li>At <a href="https://claude.ai/code/routines" target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">claude.ai/code/routines <ExternalLink className="inline size-3" aria-hidden /></a>, create a routine with your repository, the SignalForge connector, and the prompt below.</li>
                <li>Edit the routine, add an <span className="font-medium">API</span> trigger, copy its URL and generate a token.</li>
                <li>Paste both here. Protect your default branch on GitHub so changes can only arrive through pull requests.</li>
              </ol>
              <CopyBlock label="Routine prompt" text={ROUTINE_PROMPT} />
              {r.routine.saved && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span>Routine <span className="font-mono">{r.routine.routineId}</span></span>
                  <Badge tone={r.routine.status === "ready" ? "positive" : r.routine.status === "error" ? "negative" : "neutral"}>
                    {r.routine.status === "ready" ? "working" : r.routine.status === "error" ? "error" : "saved, not used yet"}
                  </Badge>
                  {isAdmin && <ActionForm action={removeRoutineAction} fields={{ workspaceId: workspace.id }} label="Remove" variant="ghost" className="ml-auto" />}
                </div>
              )}
              {isAdmin && <RoutineForm workspaceId={workspace.id} saved={r.routine.saved} />}
            </Step>
          </ol>
        </CardContent>
      </Card>

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
                    <td className="py-1.5">{formatUtc(t.created_at as string)}</td>
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
