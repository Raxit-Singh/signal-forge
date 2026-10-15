import Link from "next/link";
import { AlertTriangle, CircleDashed, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { getActiveProduct, requireWorkspace } from "@/lib/server/session";
import { getCoverageSummary, type SourceCoverage } from "@/lib/server/collection/status";

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
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
  return (
    <div className="mb-4 grid gap-1 text-xs text-muted-foreground">
      <p>
        <span className="font-medium text-foreground">Sources included:</span>{" "}
        {included.length === 0
          ? "none yet — no scan has completed for this product, so no counts are shown."
          : included.map((s) => s.name).join(", ")}
        {excluded.length > 0 && (
          <>
            {" · "}
            <span className="font-medium text-foreground">Not included:</span> {describeExcluded(excluded)}
          </>
        )}
        {" · "}
        <Link href="/integrations" className="underline-offset-2 hover:underline">Details</Link>
      </p>
      {degraded.length > 0 && (
        <p className="flex items-start gap-1 text-warning">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Incomplete coverage: {degraded.map((s) => `${s.name} — ${s.detail}`).join(" ")}
          </span>
        </p>
      )}
    </div>
  );
}
