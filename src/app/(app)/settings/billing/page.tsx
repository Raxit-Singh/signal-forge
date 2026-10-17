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
import { CheckoutButton, PortalButton, ReleaseHeldForm } from "./release-form";
import { stripeEnabled, stripeMode } from "@/lib/server/billing/stripe";

export const metadata: Metadata = { title: "Plan & billing" };

const FEATURE_LABELS: Record<string, string> = {
  weekly_reports: "Weekly reports",
  daily_reports: "Daily summaries",
  feedback_intelligence: "Feedback intelligence",
  advanced_analytics: "Advanced analytics",
  advanced_integrations: "Advanced integrations",
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function BillingSettings({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { workspace } = await requireWorkspace();
  const checkout = (await searchParams).checkout;
  const supabase = await createClient();
  const [{ plan: current, status, internalGrant }, usage, { data: rows }, { data: sub }] = await Promise.all([
    getWorkspacePlan(workspace.id),
    getWorkspaceUsage(workspace.id),
    supabase.from("plans").select("*").eq("is_public", true).order("sort_order"),
    supabase.from("subscriptions").select("provider, provider_customer_id, cancel_at_period_end, current_period_end").eq("workspace_id", workspace.id).maybeSingle(),
  ]);
  const online = stripeEnabled();
  const isOwner = workspace.role === "owner";
  const subscribed = sub?.provider === "stripe";
  const priced = new Set((rows ?? []).filter((r) => r.stripe_price_id).map((r) => r.id as string));
  const plans = (rows ?? []).map((r) => planFromRow(r as PlanRow)).filter((p) => !p.retired);
  const paidOn = paidCollectionEnabled();
  const level = usage ? mentionUsageLevel(usage.mentionsConsumed, usage.mentionAllowance) : null;
  const barTone = !level || level.level === "ok" ? "bg-primary" : level.level === "warning" ? "bg-warning" : "bg-negative";

  return (
    <>
      {checkout === "success" && <p role="status" className="rounded-md border border-positive/30 px-3 py-2 text-[13px] text-positive">Payment received. Your plan updates as soon as Stripe confirms it (usually a few seconds) — refresh if it hasn&apos;t yet.</p>}
      {checkout === "cancelled" && <p role="status" className="rounded-md border px-3 py-2 text-[13px] text-muted-foreground">Checkout cancelled; nothing was charged.</p>}
      {status === "past_due" && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 px-3 py-2 text-[13px]">
          <span>Your last payment failed. Stripe will retry; update your card to keep your plan.</span>
          {isOwner && <div className="w-40"><PortalButton workspaceId={workspace.id} label="Update payment method" variant="default" /></div>}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Current plan: {current.name}
            {internalGrant ? (
              <Badge tone="info">Internal testing entitlement — not a paid subscription</Badge>
            ) : (
              <span className="text-[13px] font-normal text-muted-foreground tabular">
                {current.priceCentsMonthly === 0 ? "$0" : formatPrice(current.priceCentsMonthly, current.currency)}/month
              </span>
            )}
            {!internalGrant && status && status !== "active" && <Badge tone="warning" className="capitalize">{status.replace("_", " ")}</Badge>}
            {current.retired && <Badge tone="warning">Retired plan</Badge>}
          </CardTitle>
          <CardDescription>
            {usage ? `Billing period ${day(usage.periodStart)} – ${day(usage.periodEnd)} (renews ${day(usage.periodEnd)}).` : "Usage is unavailable right now."}
            {" "}Limits are enforced on the server for every workspace.
            {internalGrant && ` This workspace has ${current.name} limits for internal testing${internalGrant.expires_at ? ` until ${day(internalGrant.expires_at)}` : ""}; nothing is billed.`}
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
                ) : !online || !isOwner || internalGrant ? (
                  <Button size="sm" disabled className="w-full" aria-describedby="checkout-note">
                    {p.priceCentsMonthly > current.priceCentsMonthly ? "Upgrade" : "Change plan"}
                  </Button>
                ) : subscribed ? (
                  <PortalButton workspaceId={workspace.id} label={p.priceCentsMonthly === 0 ? "Cancel subscription" : p.priceCentsMonthly > current.priceCentsMonthly ? "Upgrade" : "Change plan"} />
                ) : p.priceCentsMonthly > 0 && priced.has(p.id) ? (
                  <CheckoutButton workspaceId={workspace.id} planId={p.id} label={`Upgrade to ${p.name}`} />
                ) : (
                  <Button size="sm" disabled className="w-full" aria-describedby="checkout-note">{p.priceCentsMonthly === 0 ? "Included" : "Not available yet"}</Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {online && isOwner && subscribed && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <span className="text-muted-foreground">
            {sub?.cancel_at_period_end && sub.current_period_end ? `Your subscription ends on ${day(sub.current_period_end as string)}; you keep your plan until then. ` : ""}
            Invoices, payment method and cancellation are in Stripe&apos;s billing portal.
          </span>
          <div className="w-44"><PortalButton workspaceId={workspace.id} /></div>
        </div>
      )}
      <p id="checkout-note" className="text-xs text-muted-foreground">
        {!online
          ? "Online payment isn't set up on this server yet, so plans can't be purchased or changed in the app. "
          : !isOwner ? "Only the workspace owner can change the plan. "
          : stripeMode() === "test" ? "Payments are in Stripe test mode: use a test card (4242 4242 4242 4242); nothing is charged. " : ""}
        Payments are handled by Stripe; SignalForge never sees card details. Prices are in USD, billed monthly; no annual
        plans for now. Refresh intervals and keyword refresh targets are scheduling targets, not guaranteed discovery times; platforms that only
        support polling are never real-time.
        {paidOn ? "" : " Paid platforms (Reddit, X, LinkedIn, TikTok, Instagram, Facebook, Substack, Google web/news, Trustpilot) are not switched on for this server yet."}
      </p>
    </>
  );
}
