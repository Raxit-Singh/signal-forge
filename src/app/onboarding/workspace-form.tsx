"use client";

import { Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { createWorkspaceAction } from "../actions/workspace";

export function CreateWorkspaceForm() {
  const [state, action] = useFormAction(createWorkspaceAction, idle);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="name" label="Workspace name" placeholder="Acme Inc." maxLength={80} required autoFocus state={state}
        hint="Usually your company or team name." />
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Creating…">Continue</SubmitButton>
      </div>
    </form>
  );
}
