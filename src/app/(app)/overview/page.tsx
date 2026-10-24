import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle, PackagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, getWorkspacePlan, requireWorkspace } from "@/lib/server/session";
import { CoverageNotice, EmptyState, PageHeader } from "@/components/page";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCoverageSummary } from "@/lib/server/collection/status";
import { integrationInfo } from "@/lib/domain/integrations";
import { formatCount, formatRelative, formatTime } from "@/lib/format";
import { categoryLabel } from "@/lib/ai/cluster";
import { claudeConnected } from "@/lib/server/agent/tasks";
import { createAdminClient } from "@/lib/supabase/admin";
import { IssueKind, PRIORITY_TONE, type Cluster } from "@/components/feedback/issue-parts";
import { getTimeZone } from "@/lib/server/timezone";

export const metadata: Metadata = { title: "Overview" };

/** Server components render once per request; reading the clock here is intentional. */
function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

const NOTICES: Record<string, string> = { password_updated: "Your password was updated." };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const tz = await getTimeZone();
  const at = (d: string | Date) => formatTime(d, tz);
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  const notice = NOTICES[(await searchParams).notice ?? ""];

  if (!product) {
    return (
      <>
        <PageHeader title="Overview" />
        <EmptyState icon={PackagePlus} title="Add your first product" action={{ href: "/onboarding/product", label: "Add product" }}>
          SignalForge listens for conversations about a product you choose. Add one to get started.
        </EmptyState>
      </>
    );
  }

  const supabase = await createClient();
  const weekAgo = isoDaysAgo(7);
  const twoWeeksAgo = isoDaysAgo(14);
  const active = ["relevant", "pending", "user_relevant"];
  const [{ count: keywordCount }, claude, { plan }, coverage, { count: weekCount }, { count: lastWeekCount }, { data: issueRows }, { data: recent }] = await Promise.all([
    supabase.from("product_aliases").select("id", { count: "exact", head: true }).eq("product_id", product.id).eq("enabled", true),
    claudeConnected(createAdminClient(), workspace.id),
    getWorkspacePlan(workspace.id),
    getCoverageSummary(product.id),
    supabase.from("mentions").select("id", { count: "exact", head: true })
      .eq("product_id", product.id).eq("dedup_kind", "original").in("relevance_status", active).gte("published_at", weekAgo),
    supabase.from("mentions").select("id", { count: "exact", head: true })
      .eq("product_id", product.id).eq("dedup_kind", "original").in("relevance_status", active).gte("published_at", twoWeeksAgo).lt("published_at", weekAgo),
    supabase.from("feedback_clusters").select("id, category, title, report_count, suggested_priority")
      .eq("product_id", product.id).in("status", ["open", "acknowledged"])
      .order("priority_score", { ascending: false, nullsFirst: false }).order("report_count", { ascending: false }).limit(3),
    supabase.from("mentions").select("id, source, source_url, title, content, published_at")
      .eq("product_id", product.id).eq("dedup_kind", "original").in("relevance_status", active)
      .order("published_at", { ascending: false }).limit(5),
  ]);
  const collecting = coverage.included.length > 0;
  const issues = (issueRows ?? []) as Array<Pick<Cluster, "id" | "category" | "title" | "report_count" | "suggested_priority">>;
  const week = weekCount ?? 0;
  const lastWeek = lastWeekCount ?? 0;
  const change = lastWeek > 0 ? Math.round(((week - lastWeek) / lastWeek) * 100) : null;
  const sources = coverage.included.length;

  const steps = [
    { done: true, label: "Product added", href: "/settings/products" },
    { done: (keywordCount ?? 0) > 0, label: `${keywordCount ?? 0} active keyword${keywordCount === 1 ? "" : "s"}`, href: `/settings/products/${product.id}/keywords` },
    {
      done: collecting,
      label: collecting ? `Collecting from ${sources} source${sources === 1 ? "" : "s"}` : "Run the first scan",
      href: collecting ? "/integrations" : `/onboarding/${product.id}/scan`,
    },
    { done: claude, label: claude ? "Claude connected" : "Connect Claude (optional)", href: "/settings/agent" },
  ];

  return (
    <>
      <PageHeader
        title={product.name}
        description={<>Overview · {plan.name} plan</>}
        actions={product.onboardingStep < 6 ? (
          <Button asChild size="sm"><Link href="/onboarding">Finish setup</Link></Button>
        ) : undefined}
      />
      {notice && <p role="status" className="mb-4 rounded-md border bg-muted px-3 py-2 text-[13px]">{notice}</p>}
      <CoverageNotice />

      {issues.length > 0 && (
        <Card className="mb-4" data-testid="overview-issues">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Top issues</CardTitle>
            <Link href="/feedback" className="text-xs text-muted-foreground hover:underline">All issues</Link>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-1">
              {issues.map((c) => (
                <li key={c.id}>
                  <Link href={`/feedback#issue-${c.id}`} className="group flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1 py-1.5 text-[13px] hover:bg-muted/50 sm:min-h-0">
                    <IssueKind category={c.category} fallback={categoryLabel(c.category)} />
                    <span className="min-w-0 flex-1 font-medium group-hover:underline group-hover:underline-offset-2 max-sm:order-last max-sm:basis-full">{c.title}</span>
                    <span className="text-xs text-muted-foreground tabular">{c.report_count} report{c.report_count === 1 ? "" : "s"}</span>
                    {c.suggested_priority && <Badge tone={PRIORITY_TONE[c.suggested_priority]}>{c.suggested_priority[0]!.toUpperCase() + c.suggested_priority.slice(1)}</Badge>}
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent mentions</CardTitle>
            {collecting && <Link href="/mentions" className="text-xs text-muted-foreground hover:underline">View all</Link>}
          </CardHeader>
          <CardContent>
            {!collecting ? (
              <div className="grid gap-2 py-8 text-center">
                <p className="font-medium">No mention data yet</p>
                <p className="mx-auto max-w-md text-[13px] text-muted-foreground">
                  Nothing is shown until a source has actually been searched, because no data is not the same as no mentions.
                </p>
                <div className="mt-2 flex justify-center">
                  <Button asChild size="sm"><Link href={`/onboarding/${product.id}/scan`}>Run first scan</Link></Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                <p className="text-[13px]">
                  <span className="text-lg font-semibold tabular">{formatCount(week)}</span>{" "}
                  <span className="text-muted-foreground">
                    mention{week === 1 ? "" : "s"} in the last 7 days
                    {change !== null && <>, <span className={cn("tabular", change > 0 ? "text-foreground" : undefined)}>{change > 0 ? "+" : ""}{change}%</span> vs the week before</>}
                    {change === null && lastWeek === 0 && week > 0 && ", none the week before"}
                    {" "}(duplicates and posts marked not relevant excluded). <Link href="/buzz" className="underline underline-offset-2 hover:text-foreground">See trends in Buzz Analytics →</Link>
                  </span>
                </p>
                {(recent ?? []).length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No matching mentions collected yet.</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {(recent ?? []).map((m) => (
                      // Phones: platform and time on one line, the title below at full width (a long
                      // platform badge left the title a few pixels wide). Wider screens: one line.
                      <li key={m.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2 text-[13px] sm:flex-nowrap">
                        <Badge className="shrink-0 whitespace-nowrap">{integrationInfo(m.source)?.name.replace(/ \/ Stack Exchange$/, "") ?? m.source}</Badge>
                        <a href={m.source_url} target="_blank" rel="noopener noreferrer nofollow ugc" dir="auto" title={m.title || m.content?.slice(0, 300) || m.source_url}
                          className="min-w-0 truncate text-start hover:underline max-sm:order-last max-sm:basis-full sm:flex-1">
                          {m.title || m.content?.slice(0, 120) || m.source_url}
                        </a>
                        <time dateTime={m.published_at} title={at(m.published_at)} className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {formatRelative(m.published_at)}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Setup</CardTitle></CardHeader>
          <CardContent>
            <ul className="grid gap-2.5">
              {steps.map((s) => (
                <li key={s.label} className="flex items-start gap-2 text-[13px]">
                  {s.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" aria-label="Done" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not done" />
                  )}
                  <Link href={s.href} className={cn("hover:underline", s.done && "text-muted-foreground")}>{s.label}</Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
