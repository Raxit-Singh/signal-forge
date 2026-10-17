import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { hasRole, requireWorkspace } from "@/lib/server/session";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { RenameWorkspaceForm, DeleteWorkspaceForm } from "./forms";
import { InviteForm, MemberControls, RevokeInvitation } from "./members";
import { formatUtc } from "@/lib/format";

export const metadata: Metadata = { title: "Workspace settings" };

export default async function WorkspaceSettings() {
  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: members } = await supabase
    .from("workspace_members")
    .select("user_id, role, created_at, profiles:user_id(email, display_name)")
    .eq("workspace_id", workspace.id)
    .order("created_at");
  const isAdmin = hasRole(workspace.role, "admin");
  const isOwner = workspace.role === "owner";
  const { data: invitations } = isAdmin
    ? await supabase.from("workspace_invitations").select("id, email, role, created_at, expires_at")
      .eq("workspace_id", workspace.id).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>Name shown to everyone in this workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {isAdmin ? (
            <RenameWorkspaceForm workspaceId={workspace.id} name={workspace.name} />
          ) : (
            <p>{workspace.name}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>Everyone with access to this workspace and its products.</CardDescription>
        </CardHeader>
        <ul className="divide-y" aria-label="Members" data-testid="members">
          {(members ?? []).map((m) => {
            const p = m.profiles as unknown as { email: string; display_name: string | null } | null;
            return (
              <li key={m.user_id as string} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate">
                  {p?.display_name ? <>{p.display_name} <span className="text-muted-foreground">· {p.email}</span></> : p?.email}
                  {m.user_id === user.id && <span className="text-muted-foreground"> (you)</span>}
                </span>
                <Badge className="capitalize">{m.role as string}</Badge>
                <MemberControls workspaceId={workspace.id} userId={m.user_id as string} role={m.role as string} isSelf={m.user_id === user.id}
                  canManage={isAdmin} isOwnerViewer={isOwner} />
              </li>
            );
          })}
        </ul>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Invite people</CardTitle>
            <CardDescription>
              An invitation is a link for one email address, valid for 7 days and usable once. They sign in (or create an account) with that
              address to join. {isOwner ? "" : "Only owners can invite admins."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <InviteForm workspaceId={workspace.id} canInviteAdmins={isOwner} />
            {(invitations ?? []).length > 0 && (
              <div className="grid gap-1">
                <p className="text-xs font-medium">Waiting to be accepted</p>
                <ul className="divide-y rounded-md border" aria-label="Pending invitations" data-testid="pending-invitations">
                  {(invitations ?? []).map((i) => (
                    <li key={i.id as string} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">{i.email as string}</span>
                      <Badge className="capitalize">{i.role as string}</Badge>
                      <span className="text-xs text-muted-foreground">expires {formatUtc(i.expires_at as string)}</span>
                      <RevokeInvitation workspaceId={workspace.id} invitationId={i.id as string} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {workspace.role === "owner" && (
        <Card className="border-negative/40">
          <CardHeader>
            <CardTitle>Delete workspace</CardTitle>
            <CardDescription>
              Permanently deletes all products, keywords, collected data and settings in this workspace. Cancel any paid
              plan first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteWorkspaceForm workspaceId={workspace.id} name={workspace.name} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
