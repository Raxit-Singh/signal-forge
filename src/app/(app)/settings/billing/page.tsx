import type { Metadata } from "next";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspacePlan, requireWorkspace } from "@/lib/server/session";
import { formatPrice, planFromRow, type PlanRow } from "@/lib/domain/plans";
import { Badge, Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Plan & billing" };

const FEATURE_LABELS: Record<string, string> = {
  weekly_reports: "Weekly reports",
  daily_reports: "Daily summaries",
  feedback_intelligence: "Feedback intelligence",
  advanced_analytics: "Advanced analytics",
  advanced_integrations: "Advanced integrations",
};

function interval(minutes: number) {
  if (minutes >= 1440) return `every ${Math.round(minutes / 1440)} day${minutes >= 2880 ? "s" : ""}`;
  return `every ${Math.round(minutes / 60)}h`;
}

export default async function BillingSettings() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const [{ plan: current, status }, { data: rows }] = await Promise.all([
    getWorkspacePlan(workspace.id),
    supabase.from("plans").select("*").eq("is_public", true).order("sort_order"),
  ]);
  const plans = (rows ?? []).map((r) => planFromRow(r as PlanRow));

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Current plan: {current.name}
            {status && status !== "active" && <Badge tone="warning" className="capitalize">{status.replace("_", " ")}</Badge>}
          </CardTitle>
          <CardDescription>
            Paid plans and checkout are not open yet. Limits below are enforced on the server for every workspace today.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => (
          <Card key={p.id} className={cn("flex flex-col p-4", p.id === current.id && "border-primary ring-1 ring-primary")}>
            <div className="flex items-baseline justify-between">
              <h3 className="font-semibold">{p.name}</h3>
              {p.id === current.id && <Badge tone="accent">Current</Badge>}
            </div>
            <p className="mt-1 text-xl font-semibold tabular">
              {formatPrice(p.priceCentsMonthly, p.currency)}
              {p.priceCentsMonthly > 0 && <span className="text-[13px] font-normal text-muted-foreground">/mo</span>}
            </p>
            <ul className="mt-3 grid gap-1.5 text-[13px]">
              <li className="tabular">{p.maxProducts} product{p.maxProducts === 1 ? "" : "s"}</li>
              <li className="tabular">{p.monthlyMentionLimit.toLocaleString()} mentions / month</li>
              <li className="tabular">{p.historyDays} days of history</li>
              <li>Monitoring {interval(p.monitoringIntervalMinutes)}</li>
              {p.maxCompetitorsPerProduct > 0 && <li className="tabular">{p.maxCompetitorsPerProduct} competitors per product</li>}
              {p.monthlyInvestigations > 0 && <li className="tabular">{p.monthlyInvestigations} codebase investigations / month</li>}
              {Object.entries(FEATURE_LABELS).filter(([k]) => p.features[k]).map(([k, label]) => (
                <li key={k} className="flex items-center gap-1.5 text-muted-foreground">
                  <Check className="size-3.5 text-positive" aria-hidden />{label}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
