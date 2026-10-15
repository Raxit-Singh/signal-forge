import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { hasRole, requireWorkspace } from "@/lib/server/session";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { RenameWorkspaceForm, DeleteWorkspaceForm } from "./forms";

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
          <CardDescription>Inviting teammates arrives with team billing; for now each workspace has its owner.</CardDescription>
        </CardHeader>
        <ul className="divide-y">
          {(members ?? []).map((m) => {
            const p = m.profiles as unknown as { email: string; display_name: string | null } | null;
            return (
              <li key={m.user_id as string} className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate">
                  {p?.display_name ? <>{p.display_name} <span className="text-muted-foreground">· {p.email}</span></> : p?.email}
                  {m.user_id === user.id && <span className="text-muted-foreground"> (you)</span>}
                </span>
                <Badge className="capitalize">{m.role as string}</Badge>
              </li>
            );
          })}
        </ul>
      </Card>

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
