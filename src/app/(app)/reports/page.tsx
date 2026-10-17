import type { Metadata } from "next";
import Link from "next/link";
import { FileText, PackagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import type { ReportData } from "@/lib/reports/weekly";
import { formatCount, formatUtc } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ai/action-form";
import { generateReportNowAction } from "@/app/actions/reports";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  if (!product) {
    return (
      <>
        <PageHeader title="Reports" />
        <EmptyState icon={PackagePlus} title="Add a product first" action={{ href: "/onboarding/product", label: "Add product" }}>
          Reports are made per product.
        </EmptyState>
      </>
    );
  }
  const supabase = await createClient();
  const { data } = await supabase.from("reports").select("id, kind, period_start, period_end, status, data, created_at")
    .eq("product_id", product.id).order("period_start", { ascending: false }).limit(52);
  const reports = (data ?? []) as Array<{ id: string; kind: string; period_start: string; period_end: string; status: string; data: ReportData | null; created_at: string }>;
  const canGenerate = hasRole(workspace.role, "member");

  return (
    <>
      <PageHeader title="Reports" description={<>Weekly reports for {product.name}, made every Monday for the week before (UTC). Every number is computed from the same stored data as the dashboards.</>} />
      <div className="grid gap-4">
        {canGenerate && (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-[13px]">
              <span className="text-muted-foreground">Need numbers now? Make a report for the last 7 days.</span>
              <ActionForm action={generateReportNowAction} fields={{ productId: product.id }} label="Report for the last 7 days" pendingLabel="Generating…" />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>All reports</CardTitle>
            <CardDescription>Open one to read, print or save as PDF, or download its numbers as CSV.</CardDescription>
          </CardHeader>
          <CardContent>
            {reports.length === 0 ? (
              <EmptyState icon={FileText} title="No reports yet">
                The first weekly report is made after a full week (Monday to Sunday, UTC) of monitoring.
              </EmptyState>
            ) : (
              <ul className="grid divide-y" aria-label="Reports" data-testid="reports">
                {reports.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-[13px] first:pt-0 last:pb-0">
                    <Link href={`/reports/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                      {r.data?.period.label ?? `${r.period_start.slice(0, 10)} – ${r.period_end.slice(0, 10)}`}
                    </Link>
                    <Badge tone={r.kind === "weekly" ? "info" : "neutral"}>{r.kind === "weekly" ? "Weekly" : "Last 7 days"}</Badge>
                    {r.data && <span className="text-xs text-muted-foreground">{formatCount(r.data.current.mentions)} mentions</span>}
                    <span className="ml-auto text-xs text-muted-foreground">Made {formatUtc(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
