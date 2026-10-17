"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { openBillingPortalAction, releaseHeldMentionsAction, startCheckoutAction } from "@/app/actions/billing";

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

export function CheckoutButton({ workspaceId, planId, label }: { workspaceId: string; planId: string; label: string }) {
  const [state, action] = useActionState(startCheckoutAction, idle);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="planId" value={planId} />
      <SubmitButton size="sm" className="w-full" pendingLabel="Opening checkout…">{label}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function PortalButton({ workspaceId, label = "Manage billing", variant = "secondary" }: { workspaceId: string; label?: string; variant?: "default" | "secondary" }) {
  const [state, action] = useActionState(openBillingPortalAction, idle);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <SubmitButton size="sm" variant={variant} className="w-full" pendingLabel="Opening…">{label}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
