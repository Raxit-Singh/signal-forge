"use client";

import { Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { deleteWorkspaceAction, renameWorkspaceAction } from "@/app/actions/workspace";

export function RenameWorkspaceForm({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [state, action] = useFormAction(renameWorkspaceAction, idle);
  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <Field name="name" label="Name" defaultValue={name} maxLength={80} required state={state} className="min-w-60 flex-1" />
        <SubmitButton variant="secondary" pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}

export function DeleteWorkspaceForm({ workspaceId, name }: { workspaceId: string; name: string }) {
  const [state, action] = useFormAction(deleteWorkspaceAction, idle);
  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <Field name="confirm" label={`Type “${name}” to confirm`} autoComplete="off" state={state} className="min-w-60 flex-1" />
        <SubmitButton variant="destructive" pendingLabel="Deleting…">Delete workspace</SubmitButton>
      </div>
    </form>
  );
}
