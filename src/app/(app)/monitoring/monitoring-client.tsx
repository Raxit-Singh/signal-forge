"use client";

import { useState } from "react";
import { cancelBoostAction, createBoostAction, setMonitoringModeAction, setSourceEnabledAction } from "@/app/actions/monitoring";
import { FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/primitives";
import { idle } from "@/lib/action-state";
import { cn } from "@/lib/utils";

const MODES = [
  { id: "eco", label: "Eco", text: "Fewest checks. Quiet sources are checked every 4–24 h; paid sources least often." },
  { id: "balanced", label: "Balanced", text: "Checks every 2–12 h depending on activity." },
  { id: "priority", label: "Priority", text: "Fastest discovery: busy sources every hour, never slower than 6 h." },
] as const;

export function ModeForm({ productId, mode, canEdit, planNote }: { productId: string; mode: string; canEdit: boolean; planNote: string }) {
  const [state, action] = useFormAction(setMonitoringModeAction, idle);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="productId" value={productId} />
      <fieldset className="grid gap-2 sm:grid-cols-3" disabled={!canEdit}>
        <legend className="sr-only">Monitoring mode</legend>
        {MODES.map((m) => (
          <label key={m.id} className="flex cursor-pointer gap-2 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-accent/40">
            <input type="radio" name="mode" value={m.id} defaultChecked={mode === m.id} className="mt-0.5 accent-[var(--primary)]" />
            <span className="grid gap-0.5">
              <span className="text-[13px] font-medium">{m.label}</span>
              <span className="text-xs text-muted-foreground">{m.text}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">{planNote}</p>
      {canEdit && <div className="flex items-center gap-3"><SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">Save mode</SubmitButton></div>}
      <FormMessage state={state} />
    </form>
  );
}

export function SourceToggle({ productId, platform, name, enabled, paid, disabledReason }: {
  productId: string; platform: string; name: string; enabled: boolean; paid: boolean; disabledReason?: string;
}) {
  const [state, action] = useFormAction(setSourceEnabledAction, idle);
  const [confirm, setConfirm] = useState(false);
  return (
    <form action={action} className="grid gap-1.5">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="platform" value={platform} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      {!enabled && paid && !disabledReason && (
        <label className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" name="confirmPaid" value="yes" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
          <span>I authorize paid checks on {name} within my plan&apos;s paid-source allowance.</span>
        </label>
      )}
      <SubmitButton
        size="sm"
        variant={enabled ? "secondary" : "default"}
        disabled={Boolean(disabledReason) || (!enabled && paid && !confirm)}
        aria-label={`${enabled ? "Turn off" : "Turn on"} ${name}`}
        pendingLabel="Saving…"
      >
        {enabled ? "Turn off" : "Turn on"}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function BoostForm({ productId, platforms, maxPaidChecks, boostMinHours }: {
  productId: string;
  platforms: Array<{ id: string; name: string; paid: boolean }>;
  maxPaidChecks: number;
  boostMinHours: number;
}) {
  const [state, action] = useFormAction(createBoostAction, idle);
  const [picked, setPicked] = useState<string[]>([]);
  const paidPicked = platforms.filter((p) => p.paid && picked.includes(p.id));
  const now = new Date();
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="tzOffsetMinutes" value={now.getTimezoneOffset()} />
      <div className="grid gap-1.5">
        <Label htmlFor="boost-title">Name</Label>
        <Input id="boost-title" name="title" placeholder="v2.0 launch" maxLength={120} required defaultValue={state.status === "error" ? state.values?.title : undefined} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="boost-start">Starts</Label>
          <Input id="boost-start" name="startsAt" type="datetime-local" required defaultValue={local(now)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="boost-end">Ends (max 14 days)</Label>
          <Input id="boost-end" name="endsAt" type="datetime-local" required defaultValue={local(new Date(now.getTime() + 3 * 86_400_000))} />
        </div>
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-[13px] font-medium">Platforms</legend>
        {platforms.length === 0 ? (
          <p className="text-xs text-muted-foreground">No platforms are monitored for this product yet.</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {platforms.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox" name="platforms" value={p.id} checked={picked.includes(p.id)}
                  onChange={(e) => setPicked((xs) => (e.target.checked ? [...xs, p.id] : xs.filter((x) => x !== p.id)))}
                />
                {p.name}{p.paid && <span className="text-xs text-muted-foreground">(paid)</span>}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-[13px] font-medium">Boost level</legend>
        <div className="flex flex-wrap gap-4 text-[13px]">
          <label className="flex items-center gap-1.5"><input type="radio" name="mode" value="priority" defaultChecked />Priority (down to every {boostMinHours} h)</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="mode" value="balanced" />Balanced</label>
        </div>
      </fieldset>
      {paidPicked.length > 0 && (
        <div className={cn("grid gap-2 rounded-md border border-warning/40 bg-warning/8 p-3")}>
          <div className="grid gap-1.5">
            <Label htmlFor="boost-paid">Extra paid checks allowed (max {maxPaidChecks})</Label>
            <Input id="boost-paid" name="maxPaidChecks" type="number" min={1} max={maxPaidChecks} defaultValue={Math.min(50, maxPaidChecks)} className="w-32" />
          </div>
          <label className="flex items-start gap-1.5 text-xs">
            <input type="checkbox" name="confirmPaid" value="yes" className="mt-0.5" />
            <span>I authorize up to this many paid checks on {paidPicked.map((p) => p.name).join(", ")} during the boost. They count toward the plan&apos;s paid-source allowance and stop when either limit is reached.</span>
          </label>
        </div>
      )}
      <div><SubmitButton size="sm" pendingLabel="Scheduling…" disabled={picked.length === 0}>Schedule boost</SubmitButton></div>
      <FormMessage state={state} />
    </form>
  );
}

export function CancelBoost({ productId, boostId }: { productId: string; boostId: string }) {
  const [state, action] = useFormAction(cancelBoostAction, idle);
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="boostId" value={boostId} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Canceling…">Cancel</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
