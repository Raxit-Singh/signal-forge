"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, History, Info } from "lucide-react";
import { FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/primitives";
import { idle } from "@/lib/action-state";
import { startHistoricalSearchAction } from "@/app/actions/history";
import {
  DEFAULT_HISTORY_MODE, HISTORY_OPTIONS, earliestStart, formatDay, historyWarnings, resolveHistoryRange, type HistoryMode,
} from "@/lib/domain/history";
import type { KeywordRisk } from "@/lib/domain/keyword-risk";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/format";
import { useTimeZone } from "@/components/time";

export interface HistoryFormProps {
  productId: string;
  planName: string;
  planHistoryDays: number;
  allowance: number;
  allowanceRemaining: number;
  broad: KeywordRisk[];
  measured: { perDay: number; overDays: number } | null;
  /** Server time (ISO) so the preview matches what the server will use. */
  now: string;
  submitLabel?: string;
}

/** "How far back should SignalForge search for mentions?" with exact dates and warnings. */
export function HistoryForm(p: HistoryFormProps) {
  const [state, action] = useFormAction(startHistoricalSearchAction, idle);
  const tz = useTimeZone();
  const [mode, setMode] = useState<HistoryMode>(DEFAULT_HISTORY_MODE);
  const [launchDate, setLaunchDate] = useState("");
  const [customStart, setCustomStart] = useState("");
  const now = useMemo(() => new Date(p.now), [p.now]);
  const range = resolveHistoryRange({ mode, launchDate, customStart, now, planHistoryDays: p.planHistoryDays, planName: p.planName });
  const warnings = range.ok
    ? historyWarnings({
      days: range.days, broadKeywords: p.broad.map((b) => b.term), measured: p.measured,
      allowance: p.allowance, allowanceRemaining: p.allowanceRemaining, planName: p.planName,
    })
    : [];
  const minDay = formatDay(earliestStart(now, p.planHistoryDays));
  const maxDay = formatDay(new Date(now.getTime() - 86_400_000));
  const serverError = state.status === "error" ? state.fields : undefined;

  return (
    <form action={action} className="grid gap-4" noValidate>
      <input type="hidden" name="productId" value={p.productId} />
      <FormMessage state={state} />
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-[14px] font-medium">How far back should SignalForge search for mentions?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {HISTORY_OPTIONS.map((o) => {
            const tooFar = o.days !== undefined && o.days > p.planHistoryDays;
            return (
              <label
                key={o.mode}
                className={cn(
                  "press flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-foreground/[0.08] px-4 py-2.5 text-[14px] transition-colors hover:border-foreground/20",
                  mode === o.mode && "border-foreground/35 bg-foreground/[0.06] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_10%,transparent)]",
                  tooFar && "cursor-not-allowed opacity-50 hover:border-foreground/[0.08]",
                )}
              >
                <input
                  type="radio" name="mode" value={o.mode} checked={mode === o.mode} disabled={tooFar}
                  onChange={() => setMode(o.mode)} className="size-4 accent-[var(--primary)]"
                />
                <span>{o.label}</span>
                {o.mode === DEFAULT_HISTORY_MODE && <span className="ml-auto rounded-full bg-foreground/[0.07] px-2 py-0.5 text-[11px] text-muted-foreground">Recommended</span>}
                {tooFar && <span className="ml-auto rounded-full bg-foreground/[0.05] px-2 py-0.5 text-[11px] text-muted-foreground">Beyond your plan</span>}
              </label>
            );
          })}
        </div>
      </fieldset>

      {mode === "launch" && (
        <div className="grid gap-1.5">
          <Label htmlFor="launchDate">Product launch date</Label>
          <Input id="launchDate" name="launchDate" type="date" min={minDay} max={maxDay} value={launchDate}
            onChange={(e) => setLaunchDate(e.target.value)} className="sm:w-56" aria-invalid={Boolean(serverError?.launchDate) || undefined} />
          <p className="text-xs text-muted-foreground">We don&apos;t guess it — enter the day the product became public.</p>
        </div>
      )}
      {mode === "custom" && (
        <div className="grid gap-1.5">
          <Label htmlFor="customStart">Search from</Label>
          <Input id="customStart" name="customStart" type="date" min={minDay} max={maxDay} value={customStart}
            onChange={(e) => setCustomStart(e.target.value)} className="sm:w-56" aria-invalid={Boolean(serverError?.customStart) || undefined} />
        </div>
      )}

      <div className="rounded-2xl border border-foreground/[0.08] bg-foreground/[0.03] px-4 py-3 text-[13px]" aria-live="polite" data-testid="history-range">
        {range.ok ? (
          <p>
            <History className="mr-1 inline size-4 align-text-bottom text-muted-foreground" aria-hidden />
            Searches from <span className="font-medium tabular">{formatTime(range.start, tz)}</span> to{" "}
            <span className="font-medium tabular">{formatTime(range.end, tz)}</span> ({range.days} day{range.days === 1 ? "" : "s"}).
            Ongoing monitoring covers everything after that.
          </p>
        ) : (
          <p className="text-muted-foreground">{range.error}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Your {p.planName} plan searches back up to {p.planHistoryDays} days. Some platforms can&apos;t search as far back; each one shows what it could reach.
        </p>
      </div>

      {p.broad.length > 0 && (
        <ul className="grid gap-1.5" aria-label="Keyword warnings">
          {p.broad.map((b) => (
            <li key={b.term} className="flex gap-2 rounded-2xl border border-warning/40 bg-warning/8 px-4 py-2.5 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
              <span>{b.message}{b.suggestion ? ` ${b.suggestion}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {warnings.map((w) => (
        <p key={w.message} role={w.level === "warning" ? "alert" : undefined}
          className={cn("flex gap-2 rounded-2xl border px-4 py-2.5 text-[13px]", w.level === "warning" ? "border-warning/40 bg-warning/8" : "border-foreground/[0.08] bg-foreground/[0.03]")}>
          {w.level === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <span>{w.message}</span>
        </p>
      ))}

      <div className="flex justify-end">
        <SubmitButton disabled={!range.ok} pendingLabel="Starting…">{p.submitLabel ?? "Start historical search"}</SubmitButton>
      </div>
    </form>
  );
}
