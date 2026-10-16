import { AlertTriangle, CheckCircle2, Clock, Loader2, MinusCircle, PauseCircle } from "lucide-react";
import type { BackfillStatus } from "@/lib/server/collection/backfill-status";
import type { TaskStatus } from "@/lib/sources/backfill-plan";
import { Badge } from "@/components/ui/primitives";
import { formatCount } from "@/lib/format";

const STATE: Record<TaskStatus, { label: string; icon: React.ReactNode; tone: "neutral" | "info" | "warning" | "positive" }> = {
  queued: { label: "Queued", icon: <Clock className="size-4 text-muted-foreground" aria-hidden />, tone: "neutral" },
  searching: { label: "Searching", icon: <Loader2 className="size-4 animate-spin text-info motion-reduce:animate-none" aria-hidden />, tone: "info" },
  partial: { label: "Partially collected", icon: <AlertTriangle className="size-4 text-warning" aria-hidden />, tone: "warning" },
  paused: { label: "Paused", icon: <PauseCircle className="size-4 text-warning" aria-hidden />, tone: "warning" },
  completed: { label: "Completed", icon: <CheckCircle2 className="size-4 text-positive" aria-hidden />, tone: "positive" },
  unavailable: { label: "Unavailable", icon: <MinusCircle className="size-4 text-muted-foreground" aria-hidden />, tone: "neutral" },
};

const RUN_LABEL: Record<string, string> = {
  queued: "Queued", searching: "Searching", partial: "Finished — some history couldn't be reached", paused: "Paused",
  completed: "Completed", unavailable: "Unavailable", canceled: "Canceled",
};

const day = (iso: string) => iso.slice(0, 10);

/**
 * Historical search progress. Counts are what was actually collected; there is
 * no percentage because the number of results a source holds isn't known.
 */
export function BackfillProgress({ status, allowanceRemaining, renewsOn }: { status: BackfillStatus; allowanceRemaining: number | null; renewsOn: string | null }) {
  const done = status.platforms.filter((p) => ["completed", "partial", "unavailable"].includes(p.status));
  const pending = status.platforms.filter((p) => !done.includes(p));
  return (
    <div className="grid gap-3" data-testid="backfill-progress">
      <div className="grid gap-1 text-[13px]" aria-live="polite">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Historical search {day(status.rangeStart)} → {day(status.rangeEnd)}</span>
          <Badge tone={status.status === "completed" ? "positive" : status.status === "searching" || status.status === "queued" ? "info" : "warning"}>
            {RUN_LABEL[status.status] ?? status.status}
          </Badge>
        </p>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground tabular">{formatCount(status.inserted)}</span> mention{status.inserted === 1 ? "" : "s"} collected ·{" "}
          {done.length} of {status.platforms.length} platform{status.platforms.length === 1 ? "" : "s"} finished
          {pending.length > 0 && ` · pending: ${pending.map((p) => p.name).join(", ")}`}
          {allowanceRemaining !== null && ` · ${formatCount(allowanceRemaining)} mentions left this period`}
        </p>
        {status.status === "paused" && status.pauseReason && (
          <p className="text-warning">
            {status.pauseReason.replace(/\.$/, "")}{renewsOn && /allowance/i.test(status.pauseReason) ? ` (renews ${renewsOn})` : ""}. Everything found so far is kept.
          </p>
        )}
      </div>
      <ul className="divide-y rounded-md border">
        {status.platforms.map((p) => {
          const s = STATE[p.status];
          return (
            <li key={p.platform} className="grid gap-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                {s.icon}
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <span className="ml-auto text-xs tabular text-muted-foreground">
                  <span className="font-medium text-foreground">{formatCount(p.inserted)}</span> collected
                  {p.searches > 1 && ` · ${p.done}/${p.searches} searches done`}
                </span>
              </div>
              {p.reachedBack && <p className="text-xs text-muted-foreground">Reached back to {day(p.reachedBack)} so far.</p>}
              {p.supportedSince && <p className="text-xs text-muted-foreground">This source can only search back to {day(p.supportedSince)}.</p>}
              {p.notes.map((n) => <p key={n} className="text-xs text-warning">{n}</p>)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
