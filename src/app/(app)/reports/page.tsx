import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, FileText, PackagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import type { ReportData } from "@/lib/reports/weekly";
import { formatCount, formatTime } from "@/lib/format";
import { getTimeZone } from "@/lib/server/timezone";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/primitives";
import { CountUp } from "@/components/motion";
import { ActionForm } from "@/components/ai/action-form";
import { generateReportNowAction } from "@/app/actions/reports";

export const metadata: Metadata = { title: "Reports" };

type Row = { id: string; kind: string; period_start: string; period_end: string; status: string; data: ReportData | null; created_at: string };

/** Week-over-week change in mentions (null when there's nothing to compare). */
const changeOf = (d: ReportData | null) =>
  d && d.previous.mentions > 0 ? Math.round(((d.current.mentions - d.previous.mentions) / d.previous.mentions) * 100) : null;

/** A week's mentions per day as small capsules. */
function DayBars({ daily, height = 44 }: { daily: ReportData["daily"]; height?: number }) {
  const max = Math.max(1, ...daily.map((x) => x.mentions));
  return (
    <span className="flex items-end gap-1" style={{ height }} aria-hidden>
      {daily.map((x) => (
        <span key={x.day} className="block w-2.5 rounded-full bg-foreground/60" style={{ height: `${Math.max(8, (x.mentions / max) * 100)}%` }} />
      ))}
    </span>
  );
}

function Change({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[12px] font-medium tabular-nums ${up ? "text-positive" : "text-signal"}`}>
      {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}{up ? "+" : "−"}{Math.abs(pct)}%
    </span>
  );
}

export default async function ReportsPage() {
  const tz = await getTimeZone();
  const at = (d: string | Date) => formatTime(d, tz);
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
  const reports = (data ?? []) as Row[];
  const canGenerate = hasRole(workspace.role, "member");
  const latest = reports.find((r) => r.data) ?? null;
  const ld = latest?.data ?? null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 pb-10">
      {/* Hero: the latest week at a glance, and a report on demand. */}
      <section className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="rise grid content-start gap-5">
          <div className="grid gap-1.5">
            <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">Reports</h1>
            <p className="max-w-[56ch] text-[14px] text-muted-foreground">
              A weekly snapshot of {product.name}, made every Monday for the week before. Print it, save it as PDF or download the numbers.
            </p>
          </div>
          {canGenerate && (
            <div className="panel flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[13px]">
              <span className="text-muted-foreground">Need numbers now?</span>
              <ActionForm action={generateReportNowAction} fields={{ productId: product.id }} label="Report for the last 7 days" pendingLabel="Generating…" variant="default" />
            </div>
          )}
        </div>

        {ld && latest ? (
          <Link href={`/reports/${latest.id}`} className="panel lift press rise grid gap-5 rounded-[18px] p-5 sm:p-6" style={{ ["--d" as string]: "120ms" }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] text-muted-foreground">Latest report · {ld.period.label}</span>
              <span className="flex items-center gap-1 text-[13px]">Open<ArrowRight className="size-3.5" aria-hidden /></span>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="grid gap-1.5">
                <div className="flex items-center gap-3">
                  <CountUp value={ld.current.mentions} className="text-[52px] font-semibold leading-none tracking-[-0.045em]" />
                  <Change pct={changeOf(ld)} />
                </div>
                <span className="text-[13px] text-muted-foreground">relevant mentions · {formatCount(ld.current.uniqueAuthors)} people</span>
              </div>
              <DayBars daily={ld.daily} height={72} />
            </div>
            {ld.highlights.length > 1 && (
              <p className="line-clamp-2 border-t border-foreground/[0.06] pt-4 text-[13px] text-foreground/85">{ld.highlights[1]}</p>
            )}
          </Link>
        ) : (
          <div className="rise grid place-content-center rounded-[18px] border border-dashed p-8 text-center" style={{ ["--d" as string]: "120ms" }}>
            <FileText className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden />
            <p className="text-[15px] font-medium">No reports yet</p>
            <p className="mt-1 max-w-[42ch] text-[13px] text-muted-foreground">
              The first weekly report is made after a full week (Monday to Sunday, UTC) of monitoring.
            </p>
          </div>
        )}
      </section>

      {reports.length > 0 && (
        <section className="grid gap-3" aria-labelledby="all-reports">
          <h2 id="all-reports" className="text-[24px] font-medium tracking-[-0.03em]">All reports</h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Reports" data-testid="reports">
            {reports.map((r, i) => (
              <li key={r.id}>
                <Link href={`/reports/${r.id}`} className="panel lift press rise grid h-full gap-4 rounded-[18px] p-5" style={{ ["--d" as string]: `${200 + Math.min(i, 9) * 40}ms` }}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid gap-1">
                      <span className="text-[15px] font-medium">{r.data?.period.label ?? `${r.period_start.slice(0, 10)} – ${r.period_end.slice(0, 10)}`}</span>
                      <span className="text-[11px] text-muted-foreground">Made {at(r.created_at)}</span>
                    </span>
                    <Badge tone={r.kind === "weekly" ? "info" : "neutral"}>{r.kind === "weekly" ? "Weekly" : "Last 7 days"}</Badge>
                  </div>
                  {r.data && (
                    <div className="flex items-end justify-between gap-3">
                      <span className="grid gap-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="text-[24px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{formatCount(r.data.current.mentions)}</span>
                          <span className="text-[12px] text-muted-foreground"> mentions</span>
                        </span>
                        <Change pct={changeOf(r.data)} />
                      </span>
                      <DayBars daily={r.data.daily} />
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
