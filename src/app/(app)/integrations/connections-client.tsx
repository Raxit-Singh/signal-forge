"use client";

import { FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { Label, Textarea } from "@/components/ui/primitives";
import { idle } from "@/lib/action-state";
import { connectGooglePlayAction, disconnectSourceAction, saveDiscordChannelsAction } from "@/app/actions/connections";

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

export function Disconnect({ workspaceId, provider, productId, label }: { workspaceId: string; provider: "google_play" | "discord"; productId?: string; label: string }) {
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

export function DiscordChannels({ workspaceId, productId, available, chosen, mode }: {
  workspaceId: string; productId: string; available: Array<{ id: string; name: string }>; chosen: string[]; mode: "all" | "keywords";
}) {
  const [state, action] = useFormAction(saveDiscordChannelsAction, idle);
  return (
    <form action={action} className="grid gap-3" data-testid="discord-channels">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="productId" value={productId} />
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-[13px] font-medium">Channels to read</legend>
        {available.length === 0
          ? <p className="text-xs text-muted-foreground">The bot can&apos;t see any text channels. Give it View Channels in the channels you want monitored.</p>
          : (
            <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
              {available.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" name="channel" value={c.id} defaultChecked={chosen.includes(c.id)} />#{c.name}
                </label>
              ))}
            </div>
          )}
      </fieldset>
      <fieldset className="grid gap-1 text-[13px]">
        <legend className="mb-1 font-medium">Which messages</legend>
        <label className="flex items-start gap-2"><input type="radio" name="mode" value="all" defaultChecked={mode === "all"} className="mt-1" />
          <span>Every message in those channels <span className="text-xs text-muted-foreground">— best for feedback or support channels; every message counts toward your mention allowance</span></span></label>
        <label className="flex items-start gap-2"><input type="radio" name="mode" value="keywords" defaultChecked={mode === "keywords"} className="mt-1" />
          <span>Only messages with your product&apos;s keywords</span></label>
      </fieldset>
      <div><SubmitButton size="sm" pendingLabel="Saving…">Save channels</SubmitButton></div>
      <FormMessage state={state} />
    </form>
  );
}
