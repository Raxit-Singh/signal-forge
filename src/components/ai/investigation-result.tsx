import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { integrationInfo } from "@/lib/domain/integrations";
import { formatUtc } from "@/lib/format";
import type { InvestigationReport } from "@/lib/server/ai/investigate";

export interface InvestigationView {
  status: "pending" | "running" | "completed" | "failed" | "insufficient_data";
  report: (Partial<InvestigationReport> & { reason?: string }) | null;
  error: string | null;
  model: string | null;
  completed_at: string | null;
}

const sourceName = (s: string) => integrationInfo(s as never)?.name ?? s;

/**
 * An on-demand analysis. Every finding is shown with the posts it cites
 * (numbered links); nothing uncited is ever displayed.
 */
export function InvestigationResult({ inv }: { inv: InvestigationView }) {
  if (inv.status === "pending" || inv.status === "running") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Analysing the collected posts…
      </p>
    );
  }
  if (inv.status === "failed") {
    return <p className="flex items-start gap-1.5 text-xs text-negative"><AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />Analysis failed: {inv.error ?? "unknown error"}. Analytics are unaffected.</p>;
  }
  if (inv.status === "insufficient_data") {
    return <p className="text-xs text-muted-foreground" data-testid="investigation-insufficient">Insufficient data: {inv.report?.reason ?? "the collected posts don't support an explanation."}</p>;
  }
  const r = inv.report!;
  const evidence = r.evidence ?? [];
  const number = new Map(evidence.map((e, i) => [e.mention_id, i + 1]));
  return (
    <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-[13px]" data-testid="investigation-result">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {r.test_classifier ? <Badge tone="warning">Test classifier — not AI analysis</Badge> : <Badge tone="info">AI analysis</Badge>}
        {r.confidence && <span>Confidence: {r.confidence}</span>}
        {inv.completed_at && <span>{formatUtc(inv.completed_at)}</span>}
      </div>
      {r.summary && <p>{r.summary}</p>}
      <ul className="grid gap-1.5">
        {(r.findings ?? []).map((f, i) => (
          <li key={i} className="grid gap-0.5">
            <span>
              {f.tier === "hypothesis" && <Badge tone="neutral" className="mr-1">Hypothesis</Badge>}
              {f.statement}{" "}
              {f.mentionIds.map((id) => {
                const n = number.get(id);
                const e = evidence.find((x) => x.mention_id === id);
                return e ? (
                  <a key={id} href={e.url} target="_blank" rel="noreferrer noopener nofollow" className="ml-0.5 text-xs text-primary underline underline-offset-2" title={e.title ?? sourceName(e.source)}>
                    [{n}]
                  </a>
                ) : null;
              })}
            </span>
          </li>
        ))}
      </ul>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Posts analysed ({evidence.length})</summary>
        <ol className="mt-1 grid gap-0.5">
          {evidence.map((e, i) => (
            <li key={e.mention_id} className="flex gap-1.5">
              <span className="tabular text-muted-foreground">{i + 1}.</span>
              <a href={e.url} target="_blank" rel="noreferrer noopener nofollow" className="inline-flex min-w-0 items-center gap-1 underline underline-offset-2">
                <span className="truncate">{e.title || `${sourceName(e.source)} post`}</span><ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
              <span className="shrink-0 text-muted-foreground">{sourceName(e.source)} · {e.published_at.slice(0, 10)}</span>
            </li>
          ))}
        </ol>
      </details>
      {(r.dropped_findings ?? 0) > 0 && <p className="text-xs text-muted-foreground">{r.dropped_findings} statement{r.dropped_findings === 1 ? "" : "s"} without supporting posts {r.dropped_findings === 1 ? "was" : "were"} discarded.</p>}
    </div>
  );
}
