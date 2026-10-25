"use client";

import { FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { Label, Textarea } from "@/components/ui/primitives";
import { idle } from "@/lib/action-state";
import { connectGooglePlayAction, disconnectSourceAction } from "@/app/actions/connections";

export function GooglePlayConnect({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useFormAction(connectGooglePlayAction, idle);
  return (
    <form action={action} className="grid gap-2" data-testid="google-play-connect">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Label htmlFor="play-key">Service account key (JSON)</Label>
      <Textarea id="play-key" name="key" rows={5} required autoComplete="off" spellCheck={false} className="font-mono text-xs"
        placeholder='{"type": "service_account", "client_email": "…@….iam.gserviceaccount.com", …}' />
      <p className="text-xs text-muted-foreground">
        In Google Cloud, create a service account and a JSON key; in Play Console → Users and permissions, invite its email with
        “View app information”. SignalForge checks the key works, stores it encrypted and never shows it again.
      </p>
      <div className="flex flex-wrap items-center gap-2"><SubmitButton size="sm" pendingLabel="Checking…">Connect Google Play</SubmitButton></div>
      <FormMessage state={state} />
    </form>
  );
}

export function Disconnect({ workspaceId, provider, productId, label }: { workspaceId: string; provider: "google_play"; productId?: string; label: string }) {
  const [state, action] = useFormAction(disconnectSourceAction, idle);
  return (
    <form action={action} className="grid gap-2" onSubmit={(e) => {
      if (!window.confirm(`${label}? Collection from it stops.`)) e.preventDefault();
    }}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="provider" value={provider} />
      <input type="hidden" name="productId" value={productId ?? ""} />
      <div><SubmitButton size="sm" variant="ghost" pendingLabel="Disconnecting…">{label}</SubmitButton></div>
      <FormMessage state={state} />
    </form>
  );
}
