"use client";

import { Field, FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { updateAiSettingsAction } from "@/app/actions/ai";

export function AiSettingsForm({ workspaceId, autoClassify, byokCap }: { workspaceId: string; autoClassify: boolean; byokCap: number | null }) {
  const [state, action] = useFormAction(updateAiSettingsAction, idle);
  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-[13px] font-medium">Classify new mentions automatically</legend>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="radio" name="autoClassify" value="on" defaultChecked={autoClassify} /> On — sentiment, feedback category and an “about the product?” hint for each new mention
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="radio" name="autoClassify" value="off" defaultChecked={!autoClassify} /> Off — no model calls for classification
        </label>
      </fieldset>
      <Field
        name="byokCap"
        label="Monthly token cap for your own API key"
        optional
        inputMode="numeric"
        defaultValue={byokCap ? String(byokCap) : ""}
        placeholder="No cap"
        state={state}
        hint="Stops AI work for the rest of the billing period once your key has used this many tokens through SignalForge."
      />
      <FormMessage state={state} />
      <div><SubmitButton size="sm" pendingLabel="Saving…">Save AI settings</SubmitButton></div>
    </form>
  );
}
