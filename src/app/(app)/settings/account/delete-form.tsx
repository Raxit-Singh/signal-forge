"use client";

import { Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { deleteAccountAction } from "@/app/actions/account";

export function DeleteAccountForm() {
  const [state, action] = useFormAction(deleteAccountAction, idle);
  return (
    <form action={action} className="grid gap-3" noValidate>
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <Field name="confirm" label="Type DELETE to confirm" autoComplete="off" state={state} className="min-w-60 flex-1" />
        <SubmitButton variant="destructive" pendingLabel="Deleting…">Delete my account</SubmitButton>
      </div>
    </form>
  );
}
