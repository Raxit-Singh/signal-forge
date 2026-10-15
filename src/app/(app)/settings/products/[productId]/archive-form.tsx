"use client";

import { Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { archiveProductAction } from "@/app/actions/product";

export function ArchiveProductForm({ productId, name }: { productId: string; name: string }) {
  const [state, action] = useFormAction(archiveProductAction, idle);
  if (state.status === "success") return <FormMessage state={state} />;
  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="productId" value={productId} />
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <Field name="confirm" label={`Type “${name}” to confirm`} autoComplete="off" state={state} className="min-w-60 flex-1" />
        <SubmitButton variant="destructive" pendingLabel="Archiving…">Archive</SubmitButton>
      </div>
    </form>
  );
}
