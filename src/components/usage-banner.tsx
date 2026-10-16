import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { mentionUsageLevel, type WorkspaceUsage } from "@/lib/domain/plans";
import { formatUtc } from "@/lib/format";
import { cn } from "@/lib/utils";

/** App-wide mention allowance warning: 80 % warning, 90 % stronger warning, 100 % used up. */
export function UsageBanner({ usage }: { usage: WorkspaceUsage | null }) {
  if (!usage) return null;
  const { percent, level } = mentionUsageLevel(usage.mentionsConsumed, usage.mentionAllowance);
  if (level === "ok") return null;
  const renews = formatUtc(usage.periodEnd);
  const text = level === "exhausted"
    ? `Your ${usage.planName} plan's ${usage.mentionAllowance.toLocaleString("en-US")} mentions for this period are used up. New mentions are held (not shown or counted) and paid platforms are paused until the allowance renews on ${renews}.`
    : level === "critical"
      ? `${percent}% of this period's ${usage.mentionAllowance.toLocaleString("en-US")} mentions used. When the allowance runs out, new mentions are held until ${renews}.`
      : `${percent}% of this period's ${usage.mentionAllowance.toLocaleString("en-US")} mentions used (renews ${renews}).`;
  return (
    <div
      role={level === "warning" ? "status" : "alert"}
      aria-label="Mention allowance"
      className={cn(
        "mb-4 flex flex-wrap items-start gap-2 rounded-md border px-3 py-2 text-[13px]",
        level === "warning" ? "border-warning/40 bg-warning/5" : "border-negative/40 bg-negative/5",
      )}
    >
      <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", level === "warning" ? "text-warning" : "text-negative")} aria-hidden />
      <span className="min-w-0 flex-1">{text}</span>
      <Link href="/settings/billing" className="shrink-0 underline">Plan &amp; usage</Link>
    </div>
  );
}
