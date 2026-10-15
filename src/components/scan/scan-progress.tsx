import { AlertTriangle, CheckCircle2, Clock, Loader2, MinusCircle, XCircle } from "lucide-react";
import { integrationInfo } from "@/lib/domain/integrations";
import type { ScanJob, ScanStatus } from "@/lib/server/collection/status";
import type { PublicSourceId } from "@/lib/sources/types";
import { Badge } from "@/components/ui/primitives";

interface SourceRow {
  provider: PublicSourceId | null;
  jobs: ScanJob[];
}

function summarize(jobs: ScanJob[]) {
  const n = (k: "inserted" | "updated" | "filtered" | "duplicates" | "overLimit" | "fetched") =>
    jobs.reduce((a, j) => a + (j.result?.[k] ?? 0), 0);
  const notes = [...new Set(jobs.map((j) => j.result?.incompleteReason).filter(Boolean))] as string[];
  const errors = [...new Set(jobs.filter((j) => j.status === "dead").map((j) => j.lastError).filter(Boolean))] as string[];
  const state =
    jobs.some((j) => j.status === "running") ? "running"
    : jobs.some((j) => j.waiting) ? "waiting"
    : jobs.some((j) => j.status === "queued") ? "queued"
    : jobs.every((j) => j.status === "dead") ? "failed"
    : errors.length > 0 || notes.length > 0 ? "partial"
    : "done";
  return {
    state, notes, errors,
    stored: n("inserted"), seen: n("inserted") + n("updated"), fetched: n("fetched"),
    filtered: n("filtered"), duplicates: n("duplicates"), overLimit: n("overLimit"),
    waitReason: jobs.find((j) => j.waiting)?.lastError ?? null,
  };
}

const ICON = {
  running: <Loader2 className="size-4 animate-spin text-info" aria-hidden />,
  waiting: <Clock className="size-4 text-warning" aria-hidden />,
  queued: <Clock className="size-4 text-muted-foreground" aria-hidden />,
  failed: <XCircle className="size-4 text-negative" aria-hidden />,
  partial: <AlertTriangle className="size-4 text-warning" aria-hidden />,
  done: <CheckCircle2 className="size-4 text-positive" aria-hidden />,
};

const LABEL = {
  running: "Searching…",
  waiting: "Waiting for rate limit",
  queued: "Queued",
  failed: "Failed",
  partial: "Done, incomplete",
  done: "Done",
};

/** Real per-source progress for a scan. Every number comes from job results. */
export function ScanProgress({ scan, unavailable }: { scan: ScanStatus; unavailable: Array<{ name: string; reason?: string }> }) {
  const groups = new Map<string, SourceRow>();
  for (const j of scan.jobs) {
    const key = j.provider ?? "unknown";
    const g = groups.get(key) ?? { provider: j.provider, jobs: [] };
    g.jobs.push(j);
    groups.set(key, g);
  }
  const rows = [...groups.values()].map((g) => ({ ...g, s: summarize(g.jobs) }));
  const totalStored = rows.reduce((a, r) => a + r.s.stored, 0);
  // `seen` double-counts items matched by several keywords' queries, so it is only used as "anything matched?".
  const anyMatched = rows.some((r) => r.s.seen > 0);
  const overLimit = rows.reduce((a, r) => a + r.s.overLimit, 0);

  return (
    <div className="grid gap-3">
      <div aria-live="polite" className="text-[13px]">
        {scan.done ? (
          <p>
            <span className="font-medium">Scan finished.</span>{" "}
            {!anyMatched
              ? `No matching mentions were found in the last ${scan.lookbackDays} days on the sources below.`
              : totalStored === 0
                ? "Everything found was already stored from earlier monitoring."
                : `${totalStored} new mention${totalStored === 1 ? "" : "s"} stored from the last ${scan.lookbackDays} days.`}
          </p>
        ) : (
          <p className="text-muted-foreground">Searching the last {scan.lookbackDays} days. This page updates automatically.</p>
        )}
        {overLimit > 0 && (
          <p className="mt-1 text-warning">
            Your plan&apos;s monthly mention limit was reached; {overLimit} further mention{overLimit === 1 ? " was" : "s were"} found but not stored.
          </p>
        )}
      </div>

      <ul className="divide-y rounded-md border">
        {rows.map((r) => (
          <li key={r.provider ?? "unknown"} className="grid gap-1 p-3">
            <div className="flex flex-wrap items-center gap-2">
              {ICON[r.s.state as keyof typeof ICON]}
              <span className="font-medium">{r.provider ? integrationInfo(r.provider)?.name ?? r.provider : "Unknown source"}</span>
              <span className="text-xs text-muted-foreground">{LABEL[r.s.state as keyof typeof LABEL]}</span>
              {(r.s.state === "done" || r.s.state === "partial") && (
                <span className="ml-auto text-xs tabular text-muted-foreground">
                  {r.s.fetched} checked · <span className="font-medium text-foreground">{r.s.stored} new</span>
                  {r.s.duplicates > 0 && ` · ${r.s.duplicates} duplicate${r.s.duplicates === 1 ? "" : "s"}`}
                </span>
              )}
            </div>
            {r.s.state === "waiting" && r.s.waitReason && <p className="text-xs text-muted-foreground">{r.s.waitReason}. It will resume automatically.</p>}
            {r.s.notes.map((n) => <p key={n} className="text-xs text-warning">{n}</p>)}
            {r.s.errors.map((e) => <p key={e} className="text-xs text-negative">{e}</p>)}
          </li>
        ))}
        {unavailable.map((u) => (
          <li key={u.name} className="flex flex-wrap items-center gap-2 p-3">
            <MinusCircle className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">{u.name}</span>
            <Badge>Not searched</Badge>
            {u.reason && <span className="text-xs text-muted-foreground">{u.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
