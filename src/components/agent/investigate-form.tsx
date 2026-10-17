"use client";

import { FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { investigateWithClaudeAction } from "@/app/actions/agent";

/**
 * Starts an investigation. When a Claude Code routine will run it, the user must
 * acknowledge that the routine has their full Claude Code permissions: SignalForge
 * can instruct it not to change code but can't technically prevent it.
 */
export function InvestigateForm({ workspaceId, clusterId, routine }: { workspaceId: string; clusterId: string; routine: boolean }) {
  const [state, action] = useFormAction(investigateWithClaudeAction, idle);
  return (
    <form action={action} className="grid gap-1.5">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="clusterId" value={clusterId} />
      {routine && (
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" name="acknowledge" value="yes" required className="mt-0.5" />
          <span>
            Start my Claude Code routine for this investigation. I understand it runs with my Claude Code permissions on the
            repository: Claude is told not to change code, but SignalForge can&apos;t technically prevent it.
          </span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton variant="secondary" size="sm" pendingLabel="Starting…">Investigate with Claude</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
