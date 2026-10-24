import Link from "next/link";
import { AlertTriangle, ChevronDown, CircleDashed, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { getActiveProduct, requireWorkspace } from "@/lib/server/session";
import { getCoverageSummary, type SourceCoverage } from "@/lib/server/collection/status";

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="rise mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1.5">
        <h1 className="text-[30px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[36px]">{title}</h1>
        {description && <p className="text-[14px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon = CircleDashed, title, children, action,
}: {
  icon?: LucideIcon;
  title: string;
  children: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </span>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <div className="max-w-md text-[13px] text-muted-foreground">{children}</div>
      {action && (
        <Button asChild variant="secondary" className="mt-1">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </Card>
  );
}

const EXCLUDED_LABEL: Record<string, string> = {
  not_configured: "not configured", not_enabled: "not enabled", not_started: "not scanned yet", failing: "failing",
};

/** Free sources are named; paid ones that are simply off are summarized so the line stays readable. */
function describeExcluded(excluded: SourceCoverage[]): string {
  const paidOff = excluded.filter((s) => s.paid && (s.state === "not_configured" || s.state === "not_enabled"));
  const named = excluded.filter((s) => !paidOff.includes(s)).map((s) => `${s.name} (${EXCLUDED_LABEL[s.state] ?? s.state})`);
  if (paidOff.length) named.push(`${paidOff.length} paid source${paidOff.length === 1 ? "" : "s"} (off)`);
  return named.join(", ");
}

/**
 * Every data view states which sources its numbers include, and flags
 * incomplete or failing coverage. Missing data is never presented as zero.
 */
export async function CoverageNotice() {
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  if (!product) return null;
  const { included, degraded, excluded } = await getCoverageSummary(product.id);
  // One quiet line; the source lists open on demand.
  return (
    <details className="group mb-4 text-xs text-muted-foreground" data-testid="coverage-notice">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-md py-0.5 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className={`size-1.5 rounded-full ${included.length === 0 ? "bg-muted-foreground" : degraded.length ? "bg-warning" : "bg-positive"}`} aria-hidden />
        {included.length === 0 ? "No source scanned yet: no counts are shown" : `${included.length} source${included.length === 1 ? "" : "s"} included`}
        {degraded.length > 0 && <span className="text-warning">· {degraded.length} with incomplete coverage</span>}
        {excluded.length > 0 && <span>· {excluded.length} not included</span>}
        <ChevronDown className="size-3 transition-transform duration-200 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-2 grid max-w-[80ch] gap-1.5 rounded-lg border bg-surface p-3 shadow-panel">
        {included.length > 0 && <p><span className="font-medium text-foreground">Included:</span> {included.map((s) => s.name).join(", ")}</p>}
        {excluded.length > 0 && <p><span className="font-medium text-foreground">Not included:</span> {describeExcluded(excluded)}</p>}
        {degraded.length > 0 && (
          <p className="flex items-start gap-1 text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>Incomplete coverage: {degraded.map((s) => `${s.name} — ${s.detail}`).join(" ")}</span>
          </p>
        )}
        <Link href="/integrations" className="w-fit text-foreground underline-offset-2 hover:underline">Manage sources</Link>
      </div>
    </details>
  );
}
