"use client";

import { Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { saveRoutineAction } from "@/app/actions/agent";

export function RoutineForm({ workspaceId, saved }: { workspaceId: string; saved: boolean }) {
  const [state, action] = useFormAction(saveRoutineAction, idle);
  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Field name="fireUrl" label="Routine API trigger URL" autoComplete="off" spellCheck={false} placeholder="https://api.anthropic.com/v1/claude_code/routines/trig_…/fire" state={state} />
      <Field name="token" label="Routine token" type="password" autoComplete="off" spellCheck={false} placeholder={saved ? "Paste a new token to replace the saved one" : "sk-ant-oat01-…"} state={state}
        hint="Shown once by Claude when you generate it. Encrypted before storage and never shown again. It can only start this routine." />
      <FormMessage state={state} />
      <div><SubmitButton size="sm" pendingLabel="Saving…">{saved ? "Replace routine" : "Save routine"}</SubmitButton></div>
    </form>
  );
}
