import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Logo } from "@/components/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/form";
import { authorizeSchema, clientRedirect, parseScopes, redirectMatches, resourceUrl, SCOPES } from "@/lib/agent/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClient } from "@/lib/server/agent/oauth-store";
import { site } from "@/lib/server/agent/http";
import { getUser, getWorkspaces, hasRole } from "@/lib/server/session";
import { decideAuthorizationAction } from "./actions";

export const metadata: Metadata = { title: "Connect Claude to SignalForge" };

const SCOPE_TEXT: Record<string, string> = {
  [SCOPES.read]: "Read this workspace's products, prioritised feedback issues, their evidence and spike analyses",
  [SCOPES.agent]: "Receive developer-agent tasks you start in SignalForge and report investigation results and pull requests back",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-2">
      <header className="px-6 py-5"><Logo /></header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:pt-12"><div className="w-full max-w-md">{children}</div></main>
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <Shell>
      <Card>
        <CardHeader><CardTitle>Can&apos;t connect</CardTitle><CardDescription>{text}</CardDescription></CardHeader>
        <CardContent><Link href="/overview" className="text-[13px] underline underline-offset-2">Back to SignalForge</Link></CardContent>
      </Card>
    </Shell>
  );
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(sp as Record<string, string>).toString()}`)}`);
  const parsed = authorizeSchema.safeParse(sp);
  // Errors before the client and redirect are verified are shown here, never redirected (RFC 6749 §4.1.2.1).
  if (!parsed.success) return <Problem text="The connection request is incomplete or malformed. Start again from Claude." />;
  const req = parsed.data;
  const client = await getClient(createAdminClient(), req.client_id);
  if (!client || !redirectMatches(client.redirect_uris, req.redirect_uri)) return <Problem text="This connection request didn't come from a registered Claude client." />;
  if (req.resource && req.resource.replace(/\/$/, "") !== resourceUrl(site())) {
    redirect(clientRedirect(req.redirect_uri, { error: "invalid_target", error_description: "Unknown resource.", state: req.state }));
  }
  const scopes = parseScopes(req.scope);
  if (!scopes) redirect(clientRedirect(req.redirect_uri, { error: "invalid_scope", state: req.state }));

  const workspaces = (await getWorkspaces()).filter((w) => hasRole(w.role, "member"));
  const host = new URL(req.redirect_uri).host;
  const loopback = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle>Connect {client.client_name} to SignalForge</CardTitle>
          <CardDescription>
            Signed in as {user!.email}. After you approve, you&apos;ll be sent back to <span className="font-medium text-foreground">{host}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-[13px]">
          {loopback && (
            <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
              <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
              This returns to a program on your own computer (Claude Code). Only approve if you just started this connection yourself.
            </p>
          )}
          {workspaces.length === 0 ? (
            <p>You need to be a member (not a viewer) of a workspace to connect Claude.</p>
          ) : (
            <form action={decideAuthorizationAction} className="grid gap-4">
              {Object.entries(req).map(([k, v]) => (v === undefined ? null : <input key={k} type="hidden" name={k} value={String(v)} />))}
              <label className="grid gap-1.5">
                <span className="font-medium">Workspace</span>
                <select name="workspace_id" className="h-9 rounded-md border bg-surface px-2" defaultValue={workspaces[0]!.id}>
                  {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <span className="text-xs text-muted-foreground">Claude can only see this workspace. You can disconnect it any time in Settings → Developer agent.</span>
              </label>
              <div className="grid gap-1">
                <span className="font-medium">Claude will be able to</span>
                <ul className="list-disc pl-5 text-muted-foreground">{scopes!.map((s) => <li key={s}>{SCOPE_TEXT[s]}</li>)}</ul>
                <span className="text-xs text-muted-foreground">It can&apos;t change your settings, see other workspaces, see API keys, or start code changes on its own: implementation always needs your approval in SignalForge.</span>
              </div>
              <div className="flex justify-end gap-2">
                <SubmitButton name="decision" value="deny" variant="ghost">Deny</SubmitButton>
                <SubmitButton name="decision" value="approve">Approve</SubmitButton>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
