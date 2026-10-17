"use client";

import { FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { updateAiSettingsAction } from "@/app/actions/ai";

export function AiSettingsForm({ workspaceId, autoClassify }: { workspaceId: string; autoClassify: boolean }) {
  const [state, action] = useFormAction(updateAiSettingsAction, idle);
  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-[13px] font-medium">Analyse new mentions automatically</legend>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="radio" name="autoClassify" value="on" defaultChecked={autoClassify} /> On — every new mention is classified and grouped into issues
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="radio" name="autoClassify" value="off" defaultChecked={!autoClassify} /> Off — mentions are still collected, but not analysed
        </label>
      </fieldset>
      <FormMessage state={state} />
      <div><SubmitButton size="sm" pendingLabel="Saving…">Save</SubmitButton></div>
    </form>
  );
}
