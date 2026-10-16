"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { releaseHeldMentionsAction } from "@/app/actions/billing";

export function ReleaseHeldForm({ workspaceId, held, remaining }: { workspaceId: string; held: number; remaining: number }) {
  const [state, action] = useActionState(releaseHeldMentionsAction, idle);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <FormMessage state={state} />
      <div>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Delivering…">
          Deliver up to {Math.min(held, remaining).toLocaleString("en-US")} held mention{Math.min(held, remaining) === 1 ? "" : "s"}
        </SubmitButton>
      </div>
    </form>
  );
}
