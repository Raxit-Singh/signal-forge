"use client";

import { FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle, type ActionState } from "@/lib/action-state";

/** A one-button server action form with its own result message. */
export function ActionForm({
  action, fields, label, pendingLabel, variant = "secondary", size = "sm", className,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: "default" | "secondary" | "ghost";
  size?: "sm" | "default";
  className?: string;
}) {
  const [state, run] = useFormAction(action, idle);
  return (
    <form action={run} className={className}>
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton variant={variant} size={size} pendingLabel={pendingLabel}>{label}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
