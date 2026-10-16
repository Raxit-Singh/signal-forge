import type { Metadata } from "next";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspacePlan, getWorkspaceUsage, hasRole, requireWorkspace } from "@/lib/server/session";
import { paidCollectionEnabled } from "@/lib/server/collection/sources";
import { formatPrice, mentionUsageLevel, planFromRow, type PlanRow } from "@/lib/domain/plans";
import { formatInterval } from "@/lib/sources/adaptive";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { ReleaseHeldForm } from "./release-form";

export const metadata: Metadata = { title: "Plan & billing" };

const FEATURE_LABELS: Record<string, string> = {
  weekly_reports: "Weekly reports",
  daily_reports: "Daily summaries",
  feedback_intelligence: "Feedback intelligence",
  advanced_analytics: "Advanced analytics",
  advanced_integrations: "Advanced integrations",
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function BillingSettings() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const [{ plan: current, status }, usage, { data: rows }] = await Promise.all([
    getWorkspacePlan(workspace.id),
    getWorkspaceUsage(workspace.id),
    supabase.from("plans").select("*").eq("is_public", true).order("sort_order"),
  ]);
  const plans = (rows ?? []).map((r) => planFromRow(r as PlanRow)).filter((p) => !p.retired);
  const paidOn = paidCollectionEnabled();
  const level = usage ? mentionUsageLevel(usage.mentionsConsumed, usage.mentionAllowance) : null;
  const barTone = !level || level.level === "ok" ? "bg-primary" : level.level === "warning" ? "bg-warning" : "bg-negative";

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Current plan: {current.name}
            <span className="text-[13px] font-normal text-muted-foreground tabular">
              {current.priceCentsMonthly === 0 ? "$0" : formatPrice(current.priceCentsMonthly, current.currency)}/month
            </span>
            {status && status !== "active" && <Badge tone="warning" className="capitalize">{status.replace("_", " ")}</Badge>}
            {current.retired && <Badge tone="warning">Retired plan</Badge>}
          </CardTitle>
          <CardDescription>
            {usage ? `Billing period ${day(usage.periodStart)} – ${day(usage.periodEnd)} (renews ${day(usage.periodEnd)}).` : "Usage is unavailable right now."}
            {" "}Limits are enforced on the server for every workspace.
          </CardDescription>
        </CardHeader>
        {usage && (
          <CardContent className="grid gap-4">
            <section aria-label="Mention allowance" className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                <span className="font-medium">Mentions this period</span>
                <span className="tabular">
                  {usage.mentionsConsumed.toLocaleString("en-US")} of {usage.mentionAllowance.toLocaleString("en-US")} used ·{" "}
                  <span className="font-medium">{usage.mentionsRemaining.toLocaleString("en-US")} remaining</span>
                </span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Mentions used"
                aria-valuemin={0}
                aria-valuemax={usage.mentionAllowance}
                aria-valuenow={usage.mentionsConsumed}
              >
                <div className={cn("h-full", barTone)} style={{ width: `${level?.percent ?? 0}%` }} />
              </div>
              {level?.level === "warning" && <p className="text-xs text-warning">{level.percent}% used. You&apos;ll be warned again at 90%.</p>}
              {level?.level === "critical" && (
                <p className="text-xs text-negative">{level.percent}% used. At 100%, new mentions are held until the allowance renews.</p>
              )}
              {level?.level === "exhausted" && (
                <p className="text-xs text-negative">
                  Allowance used up{usage.exhaustedAt ? ` on ${day(usage.exhaustedAt)}` : ""}. New mentions are held — not shown, not counted,
                  not discarded — and paid platforms are paused until {day(usage.periodEnd)}. Existing mentions stay available. No overage is charged
                  and your plan is never upgraded automatically.
                </p>
              )}
              {usage.mentionsHeld > 0 && (
                <div className="grid gap-2 rounded-md border p-3 text-xs">
                  <p>
                    {usage.mentionsHeld.toLocaleString("en-US")} mention{usage.mentionsHeld === 1 ? " is" : "s are"} held from this period
                    {usage.mentionsNotHeld > 0 ? ` (and ${usage.mentionsNotHeld.toLocaleString("en-US")} more were found beyond the 1,000 that can be held; only the count is kept)` : ""}.
                    Held mentions are kept for 30 days after the period ends and are delivered only when you choose, counting toward the current allowance.
                  </p>
                  {hasRole(workspace.role, "admin") && usage.mentionsRemaining > 0 && (
                    <ReleaseHeldForm workspaceId={workspace.id} held={usage.mentionsHeld} remaining={usage.mentionsRemaining} />
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Counted: each new, unique mention that matches your keywords (rule-based relevance) or that your team marks relevant. Not counted:
                duplicates, reposts of a stored mention, items seen again, “Needs review” and excluded items, empty searches and failed requests.
                Marking a counted mention “Not relevant” returns it to this period&apos;s allowance.
              </p>
            </section>
            <section aria-label="Keyword allowance" className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <span className="font-medium">Active keywords</span>
              <span className="tabular">{usage.activeKeywords} of {usage.maxKeywords}</span>
              {usage.activeKeywords > usage.maxKeywords && (
                <p className="w-full text-xs text-warning">
                  More keywords are active than your plan includes; the extra ones are paused (kept, not searched) until you turn some off or change plan.
                </p>
              )}
            </section>
          </CardContent>
        )}
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.id === current.id;
          return (
            <Card key={p.id} className={cn("flex flex-col p-4", isCurrent && "border-primary ring-1 ring-primary")} aria-label={`${p.name} plan`}>
              <div className="flex items-baseline justify-between">
                <h3 className="font-semibold">{p.name}</h3>
                {isCurrent && <Badge tone="accent">Current</Badge>}
              </div>
              <p className="mt-1 text-xl font-semibold tabular">
                {p.priceCentsMonthly === 0 ? "$0" : formatPrice(p.priceCentsMonthly, p.currency)}
                <span className="text-[13px] font-normal text-muted-foreground">/month</span>
              </p>
              {p.description && <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>}
              <ul className="mt-3 grid gap-1.5 text-[13px]">
                <li className="tabular">{p.maxKeywords} keyword{p.maxKeywords === 1 ? "" : "s"}</li>
                <li className="tabular">{p.monthlyMentionLimit.toLocaleString("en-US")} mentions / month</li>
                <li className="tabular">{p.maxProducts} product{p.maxProducts === 1 ? "" : "s"}</li>
                <li>
                  {p.monitoringIntervalMinutes <= 60 ? "Automatic Smart Monitoring, as often as hourly" : `Automatic monitoring, at most every ${formatInterval(p.monitoringIntervalMinutes)}`}
                </li>
                <li>Keyword refresh target: within {formatInterval(p.keywordRefreshTargetMinutes)}</li>
                <li>{p.priceCentsMonthly > 0 ? "All supported platforms, subject to availability" : "Free sources only (paid platforms not included)"}</li>
                <li className="tabular">{p.historyDays} days of history</li>
                {Object.entries(FEATURE_LABELS).filter(([k]) => p.features[k]).map(([k, label]) => (
                  <li key={k} className="flex items-center gap-1.5 text-muted-foreground">
                    <Check className="size-3.5 text-positive" aria-hidden />{label}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-4">
                {isCurrent ? (
                  <Button size="sm" variant="secondary" disabled className="w-full">Current plan</Button>
                ) : (
                  <Button size="sm" disabled className="w-full" aria-describedby="checkout-note">
                    {p.priceCentsMonthly > current.priceCentsMonthly ? "Upgrade" : "Change plan"} — coming soon
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <p id="checkout-note" className="text-xs text-muted-foreground">
        Online payment isn&apos;t available yet, so plans can&apos;t be purchased or changed in the app. Prices are in USD, billed monthly; no annual
        plans for now. Refresh intervals and keyword refresh targets are scheduling targets, not guaranteed discovery times; platforms that only
        support polling are never real-time.
        {paidOn ? "" : " Paid platforms (Reddit, X, LinkedIn, TikTok, Instagram, Facebook, Substack, Google web/news, Trustpilot) are not switched on for this server yet."}
      </p>
    </>
  );
}
