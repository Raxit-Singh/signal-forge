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
import { formatRelative, formatUtc } from "@/lib/format";

export const metadata: Metadata = { title: "Overview" };

/** Server components render once per request; reading the clock here is intentional. */
function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

const NOTICES: Record<string, string> = { password_updated: "Your password was updated." };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
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
  const active = ["relevant", "pending", "user_relevant"];
  const [{ count: keywordCount }, { count: aiCount }, { plan }, coverage, { count: weekCount }, { data: recent }] = await Promise.all([
    supabase.from("product_aliases").select("id", { count: "exact", head: true }).eq("product_id", product.id).eq("enabled", true),
    supabase.from("ai_provider_connections").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
    getWorkspacePlan(workspace.id),
    getCoverageSummary(product.id),
    supabase.from("mentions").select("id", { count: "exact", head: true })
      .eq("product_id", product.id).eq("dedup_kind", "original").in("relevance_status", active).gte("published_at", weekAgo),
    supabase.from("mentions").select("id, source, source_url, title, content, published_at")
      .eq("product_id", product.id).eq("dedup_kind", "original").in("relevance_status", active)
      .order("published_at", { ascending: false }).limit(5),
  ]);
  const collecting = coverage.included.length > 0;

  const steps = [
    { done: true, label: "Product added", href: "/settings/products" },
    { done: (keywordCount ?? 0) > 0, label: `${keywordCount ?? 0} active keyword${keywordCount === 1 ? "" : "s"}`, href: `/settings/products/${product.id}/keywords` },
    { done: (aiCount ?? 0) > 0, label: "AI provider chosen", href: "/settings/ai" },
    {
      done: collecting,
      label: collecting ? `Collecting from ${coverage.included.map((s) => s.name).join(", ")}` : "Run the first scan",
      href: collecting ? "/integrations" : `/onboarding/${product.id}/scan`,
    },
  ];

  return (
    <>
      <PageHeader
        title={product.name}
        description={<>Overview · <span className="capitalize">{plan.name}</span> plan</>}
        actions={product.onboardingStep < 6 ? (
          <Button asChild size="sm"><Link href="/onboarding">Finish setup</Link></Button>
        ) : undefined}
      />
      {notice && <p role="status" className="mb-4 rounded-md border bg-muted px-3 py-2 text-[13px]">{notice}</p>}
      <CoverageNotice />

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
                  <span className="text-lg font-semibold tabular">{weekCount ?? 0}</span>{" "}
                  <span className="text-muted-foreground">
                    mention{weekCount === 1 ? "" : "s"} published in the last 7 days on the included sources (duplicates and
                    mentions marked not relevant excluded). Trends and growth arrive with Buzz Analytics.
                  </span>
                </p>
                {(recent ?? []).length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No matching mentions collected yet.</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {(recent ?? []).map((m) => (
                      <li key={m.id} className="flex items-baseline gap-2 px-3 py-2 text-[13px]">
                        <Badge className="shrink-0">{integrationInfo(m.source)?.name.replace(/ \/ Stack Exchange$/, "") ?? m.source}</Badge>
                        <a href={m.source_url} target="_blank" rel="noopener noreferrer nofollow ugc" className="min-w-0 flex-1 truncate hover:underline">
                          {m.title || m.content?.slice(0, 120) || m.source_url}
                        </a>
                        <time dateTime={m.published_at} title={formatUtc(m.published_at)} className="shrink-0 text-xs text-muted-foreground">
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
