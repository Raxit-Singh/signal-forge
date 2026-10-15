import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, requireWorkspace } from "@/lib/server/session";
import { getCoverageSummary, type CoverageState } from "@/lib/server/collection/status";
import { integrationInfo } from "@/lib/domain/integrations";
import { formatRelative, formatUtc } from "@/lib/format";
import { PageHeader } from "@/components/page";
import { IntegrationList, type LiveStatus } from "@/components/integration-list";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Integrations" };

const STATE: Record<CoverageState, LiveStatus["tone"]> = {
  live: "positive", partial: "warning", failing: "negative", not_configured: "neutral", not_enabled: "neutral", not_started: "neutral",
};
const STATE_LABEL: Record<CoverageState, string> = {
  live: "Collecting", partial: "Collecting · incomplete", failing: "Problem", not_configured: "Not configured", not_enabled: "Not enabled", not_started: "Not scanned yet",
};

interface JobRow {
  id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  result: { provider?: string; inserted?: number; complete?: boolean; incompleteReason?: string; skipped?: string } | null;
  created_at: string;
  finished_at: string | null;
  scan_id: string | null;
}

export default async function IntegrationsPage() {
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  const supabase = await createClient();

  const [coverage, { data: health }, { data: jobs }] = await Promise.all([
    product ? getCoverageSummary(product.id) : null,
    supabase.from("source_health").select("provider, status, last_success_at, last_error_at, last_error, detail"),
    supabase
      .from("jobs")
      .select("id, status, attempts, max_attempts, last_error, result, created_at, finished_at, scan_id")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const healthBy = new Map((health ?? []).map((h) => [h.provider as string, h]));
  const live: Record<string, LiveStatus> = {};
  for (const s of coverage?.sources ?? []) {
    const h = healthBy.get(s.id);
    const lines: string[] = [];
    if (s.lastCoveredAt) lines.push(`Searched up to ${formatRelative(s.lastCoveredAt)} (${formatUtc(s.lastCoveredAt)}).`);
    if (s.detail && s.state !== "live") lines.push(s.detail);
    if (s.note) lines.push(s.note);
    if (h?.status === "degraded" && h.last_error_at && (!h.last_success_at || h.last_error_at > h.last_success_at)) {
      lines.push(`Recent issue: ${h.last_error}`);
    }
    live[s.id] = { tone: STATE[s.state], label: STATE_LABEL[s.state], lines };
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        description={<>Data sources SignalForge uses, what each can access, and their live status{product ? <> for {product.name}</> : null}.</>}
      />
      <div className="grid gap-6">
        <IntegrationList live={live} />

        <Card>
          <CardHeader><CardTitle>Monitoring activity</CardTitle></CardHeader>
          <CardContent>
            {(jobs ?? []).length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No collection runs yet. They appear here after the first scan.</p>
            ) : (
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <caption className="sr-only">Recent collection runs</caption>
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-1 py-1.5 font-medium">Started</th>
                      <th scope="col" className="px-1 py-1.5 font-medium">Source</th>
                      <th scope="col" className="px-1 py-1.5 font-medium">Type</th>
                      <th scope="col" className="px-1 py-1.5 font-medium">Status</th>
                      <th scope="col" className="px-1 py-1.5 text-right font-medium">New</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(jobs as JobRow[]).map((j) => (
                      <tr key={j.id} className="align-top">
                        <td className="px-1 py-1.5 whitespace-nowrap" title={formatUtc(j.created_at)}>{formatRelative(j.created_at)}</td>
                        <td className="px-1 py-1.5">{j.result?.provider ? integrationInfo(j.result.provider as never)?.name ?? j.result.provider : "—"}</td>
                        <td className="px-1 py-1.5 text-muted-foreground">{j.scan_id ? "Scan" : "Scheduled"}</td>
                        <td className="px-1 py-1.5">
                          <JobStatus j={j} />
                        </td>
                        <td className="px-1 py-1.5 text-right tabular">{j.result?.inserted ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function JobStatus({ j }: { j: JobRow }) {
  if (j.status === "succeeded") {
    if (j.result?.skipped) return <Badge>Skipped · {j.result.skipped.replace(/_/g, " ")}</Badge>;
    return j.result?.complete === false
      ? <span className="grid gap-0.5"><Badge tone="warning">Incomplete</Badge><span className="text-xs text-muted-foreground">{j.result.incompleteReason}</span></span>
      : <Badge tone="positive">Done</Badge>;
  }
  if (j.status === "dead") return <span className="grid gap-0.5"><Badge tone="negative">Failed</Badge><span className="text-xs text-muted-foreground">{j.last_error}</span></span>;
  if (j.status === "running") return <Badge tone="info">Running</Badge>;
  if (j.status === "queued" && j.last_error) {
    return <span className="grid gap-0.5"><Badge tone="warning">Retrying</Badge><span className="text-xs text-muted-foreground">{j.last_error}</span></span>;
  }
  return <Badge>{j.status === "queued" ? "Queued" : j.status}</Badge>;
}
