"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { Label } from "@/components/ui/primitives";
import { idle, type ActionState } from "@/lib/action-state";
import { inviteMemberAction, removeMemberAction, revokeInvitationAction, setMemberRoleAction, type InviteState } from "@/app/actions/members";

const ROLE_HELP = "Viewers read everything; members can also act on issues and run analyses; admins manage products, keywords, sources and members.";
const SELECT = "h-10 cursor-pointer rounded-xl border border-foreground/[0.1] bg-foreground/[0.03] px-3 text-[13px] outline-none transition-colors hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25";

export function InviteForm({ workspaceId, canInviteAdmins }: { workspaceId: string; canInviteAdmins: boolean }) {
  const [state, action] = React.useActionState(inviteMemberAction, idle as InviteState);
  const [copied, setCopied] = React.useState(false);
  const id = React.useId();
  return (
    <div className="grid gap-3">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end" data-testid="invite-form">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <Field name="email" label="Email address" type="email" required state={state.status === "invited" ? undefined : state} placeholder="teammate@company.com" />
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-role`}>Role</Label>
          <select id={`${id}-role`} name="role" defaultValue="member" className={SELECT}>
            {canInviteAdmins && <option value="admin">Admin</option>}
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <SubmitButton size="sm" pendingLabel="Inviting…">Create invitation</SubmitButton>
      </form>
      <p className="text-xs text-muted-foreground">{ROLE_HELP}</p>
      {state.status === "invited" ? (
        <div className="grid gap-2 rounded-md border border-positive/30 bg-positive/8 p-3 text-[13px]" role="status" data-testid="invite-link">
          <p>{state.message}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs">{state.link}</code>
            <Button size="sm" variant="secondary" type="button" onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.link);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
      ) : state.status !== "idle" && <FormMessage state={state as ActionState} />}
    </div>
  );
}

export function MemberControls({ workspaceId, userId, role, isSelf, canManage, isOwnerViewer }: {
  workspaceId: string; userId: string; role: string; isSelf: boolean; canManage: boolean; isOwnerViewer: boolean;
}) {
  const [roleState, setRole] = useFormAction(setMemberRoleAction, idle);
  const [removeState, remove] = useFormAction(removeMemberAction, idle);
  const editable = canManage && !isSelf && (isOwnerViewer || (role !== "owner" && role !== "admin"));
  const roles = isOwnerViewer ? ["owner", "admin", "member", "viewer"] : ["member", "viewer"];
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {editable && (
        <form action={setRole} className="flex items-center gap-1">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="userId" value={userId} />
          <select name="role" defaultValue={role} aria-label="Role" className={SELECT} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
            {roles.map((r) => <option key={r} value={r}>{r[0]!.toUpperCase() + r.slice(1)}</option>)}
          </select>
        </form>
      )}
      {(editable || isSelf) && (
        <form action={remove} onSubmit={(e) => {
          if (!window.confirm(isSelf ? "Leave this workspace? You'll need a new invitation to come back." : "Remove this member from the workspace?")) e.preventDefault();
        }}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="userId" value={userId} />
          <SubmitButton size="sm" variant="ghost" pendingLabel={isSelf ? "Leaving…" : "Removing…"}>{isSelf ? "Leave" : "Remove"}</SubmitButton>
        </form>
      )}
      <FormMessage state={roleState} />
      <FormMessage state={removeState} />
    </div>
  );
}

export function RevokeInvitation({ workspaceId, invitationId }: { workspaceId: string; invitationId: string }) {
  const [state, action] = useFormAction(revokeInvitationAction, idle);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <SubmitButton size="sm" variant="ghost" pendingLabel="Revoking…">Revoke</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
