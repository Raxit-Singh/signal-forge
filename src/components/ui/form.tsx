"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/primitives";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";

// Never echo these back into the page after a failed submit.
const SECRET_FIELD = /pass|secret|key|token/i;

/**
 * useActionState for forms built from <Field>. React resets uncontrolled forms
 * after every action, which would wipe the user's input on a validation error;
 * this keeps the submitted (non-secret) values so <Field> can restore them.
 */
export function useFormAction(action: (prev: ActionState, formData: FormData) => Promise<ActionState>, initial: ActionState) {
  return React.useActionState(async (prev: ActionState, formData: FormData): Promise<ActionState> => {
    const next = await action(prev, formData);
    if (next.status !== "error") return next;
    const values: Record<string, string> = {};
    for (const [k, v] of formData) if (typeof v === "string" && !SECRET_FIELD.test(k)) values[k] = v;
    return { ...next, values };
  }, initial);
}

export function SubmitButton({ children, pendingLabel, disabled, ...props }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" {...props} disabled={pending || disabled} aria-busy={pending}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.status === "idle") return null;
  const ok = state.status === "success";
  if (ok && !state.message) return null;
  return (
    <div
      role={ok ? "status" : "alert"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]",
        ok ? "border-positive/30 bg-positive/8 text-positive" : "border-negative/30 bg-negative/8 text-negative",
      )}
    >
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
      <span>{state.message}</span>
    </div>
  );
}

interface FieldProps {
  name: string;
  label: string;
  state?: ActionState;
  hint?: React.ReactNode;
  optional?: boolean;
  multiline?: boolean;
}

export function Field({
  name, label, state, hint, optional, multiline, className, ...input
}: FieldProps & Omit<React.ComponentProps<"input">, "name"> & { rows?: number }) {
  const id = React.useId();
  const error = state?.status === "error" ? state.fields?.[name] : undefined;
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  const echoed = state?.status === "error" && input.type !== "password" ? state.values?.[name] : undefined;
  const common = {
    id, name, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy,
    defaultValue: echoed ?? input.defaultValue,
  };
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {multiline ? (
        <Textarea {...(input as React.ComponentProps<"textarea">)} {...common} />
      ) : (
        <Input {...input} {...common} />
      )}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-xs text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
