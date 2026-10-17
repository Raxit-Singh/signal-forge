import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PackagePlus, Swords } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, getWorkspacePlan, hasRole, requireWorkspace } from "@/lib/server/session";
import { getCompetitorComparison } from "@/lib/server/analytics/competitors";
import { ENTITY_COLORS, MIN_CLASSIFIED_FOR_SENTIMENT } from "@/lib/analytics/competitors";
import { isValidTimeZone } from "@/lib/analytics/buzz";
import { parseRange } from "@/lib/domain/date-range";
import { integrationInfo } from "@/lib/domain/integrations";
import { formatCount, formatUtc } from "@/lib/format";
import { CoverageNotice, EmptyState, PageHeader } from "@/components/page";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { AddCompetitorForm, CompetitorControls, VolumeChart } from "./competitors-client";

export const metadata: Metadata = { title: "Competitors" };

type SearchParams = Record<string, string | undefined>;
const sourceName = (id: string) => integrationInfo(id as never)?.name.replace(/ \/ Stack Exchange$/, "") ?? id;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export default async function CompetitorsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  if (!product) {
    return (
      <>
        <PageHeader title="Competitors" />
        <EmptyState icon={PackagePlus} title="Add a product first" action={{ href: "/onboarding/product", label: "Add product" }}>
          Competitors are compared with one of your products.
        </EmptyState>
      </>
    );
  }

  const sp = await searchParams;
  const cookieTz = (await cookies()).get("sf_tz")?.value;
  const tz = cookieTz && isValidTimeZone(cookieTz) ? cookieTz : "UTC";
  const range = parseRange(sp, new Date());
  const supabase = await createClient();
  const [{ data: p }, { plan }] = await Promise.all([
    supabase.from("products").select("created_at").eq("id", product.id).single(),
    getWorkspacePlan(workspace.id),
  ]);
  const d = await getCompetitorComparison(supabase, { id: product.id, name: product.name, createdAt: p?.created_at as string }, range, tz);
  const canManage = hasRole(workspace.role, "admin");
  const limit = plan.maxCompetitorsPerProduct;
  const colorOf = new Map(d.entities.map((e, i) => [e.id, ENTITY_COLORS[i % ENTITY_COLORS.length]!]));
  const addBlocked = limit === 0
    ? `Your ${plan.name} plan doesn't include competitor tracking.`
    : d.competitors.length >= limit ? `Your ${plan.name} plan includes ${limit} competitor${limit === 1 ? "" : "s"} per product.` : null;
  const active = d.competitors.filter((c) => c.enabled);

  return (
    <>
      <PageHeader title="Competitors" description={<>{product.name} compared with competitors you choose · {range.label}</>} />
      <CoverageNotice />

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Tracked competitors</CardTitle>
            <CardDescription>
              Each competitor is searched on the same sources as {product.name}, on its own schedule. Their mentions count toward your monthly
              mention allowance. {limit > 0 && <>{d.competitors.length} of {limit} used.</>}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {d.competitors.length > 0 && (
              <ul className="grid gap-3" aria-label="Competitors">
                {d.competitors.map((c) => (
                  <li key={c.id} className="grid gap-2 rounded-md border p-3 text-[13px] sm:grid-cols-[1fr_auto] sm:items-start" data-testid="competitor">
                    <div className="grid gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {c.enabled && c.trackingProductId && <span className="size-2.5 rounded-sm" style={{ background: colorOf.get(c.trackingProductId) }} aria-hidden />}
                        <span className="font-medium">{c.name}</span>
                        {c.enabled ? <Badge tone="positive">Tracking</Badge> : <Badge tone="neutral">Paused</Badge>}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Searches: {c.keywords.map((k) => `“${k}”`).join(", ")} · since {formatUtc(c.trackedSince!)}
                        {c.websiteUrl && <> · <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{c.websiteUrl.replace(/^https?:\/\//, "")}</a></>}
                      </span>
                    </div>
                    {canManage && <CompetitorControls c={c} />}
                  </li>
                ))}
              </ul>
            )}
            {canManage
              ? <AddCompetitorForm productId={product.id} disabledReason={addBlocked} />
              : d.competitors.length === 0 && <p className="text-[13px] text-muted-foreground">No competitors yet. Ask a workspace admin to add some.</p>}
          </CardContent>
        </Card>

        {active.length === 0 ? (
          <EmptyState icon={Swords} title="No comparison yet">
            Add a competitor to compare share of voice, mention volume and sentiment with {product.name}.
          </EmptyState>
        ) : d.window.empty ? (
          <EmptyState icon={Swords} title="Nothing to compare in this period">
            The selected period ends before your competitors were being tracked. Choose a more recent period.
          </EmptyState>
        ) : d.sources.common.length === 0 ? (
          <EmptyState icon={Swords} title="No source is monitored for all of them">
            Comparisons only use sources searched for {product.name} and every competitor. Searches are still being set up, or the
            products are monitored on different sources.
          </EmptyState>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Share of voice</CardTitle>
                <CardDescription>
                  Relevant mentions from {formatUtc(d.window.from.toISOString())} on {d.sources.common.map(sourceName).join(", ")}.
                  {d.window.clamped && " The period starts when the most recently added competitor began to be tracked, so every product is measured over the same time."}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3" data-testid="share-of-voice">
                <ul className="grid gap-2" aria-label="Share of voice">
                  {d.voice.map((v) => (
                    <li key={v.id} className="grid gap-1 text-[13px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <span className="size-2.5 rounded-sm" style={{ background: colorOf.get(v.id) }} aria-hidden />
                          {v.name}{v.isProduct && <span className="text-xs text-muted-foreground">(you)</span>}
                        </span>
                        <span className="tabular text-muted-foreground">
                          {formatCount(v.mentions)} mention{v.mentions === 1 ? "" : "s"}{v.share !== null && <> · <span className="font-medium text-foreground">{pct(v.share)}</span></>}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted" aria-hidden>
                        <div className="h-2 rounded-full" style={{ width: `${(v.share ?? 0) * 100}%`, background: colorOf.get(v.id) }} />
                      </div>
                    </li>
                  ))}
                </ul>
                {d.voice.every((v) => v.share === null) && <p className="text-xs text-muted-foreground">No relevant mentions for anyone in this period yet.</p>}
                {d.sources.excluded.length > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="excluded-sources">
                    Not compared: {d.sources.excluded.map((x) => `${sourceName(x.source)} (not monitored for ${x.missingFor.join(", ")})`).join("; ")}.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Mention volume</CardTitle>
                <CardDescription>Relevant mentions per day on the compared sources.</CardDescription>
              </CardHeader>
              <CardContent>
                <VolumeChart rows={d.daily} entities={d.entities.map((e) => ({ id: e.id, name: e.name, color: colorOf.get(e.id)! }))} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sentiment</CardTitle>
                <CardDescription>
                  Sentiment toward each product from SignalForge Intelligence, over all of its classified mentions in the period. Net score = positive
                  minus negative, as a share of classified mentions; shown once at least {MIN_CLASSIFIED_FOR_SENTIMENT} are classified.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-3" aria-label="Sentiment by product" data-testid="competitor-sentiment">
                  {d.sentiment.map((s) => {
                    const c = s.summary;
                    const middle = c.neutral + c.mixed + c.uncertain;
                    return (
                      <li key={s.id} className="grid gap-1 text-[13px]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{s.name}{s.isProduct && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}</span>
                          <span className="tabular text-xs text-muted-foreground">
                            {c.net !== null ? <>Net <span className="font-medium text-foreground">{c.net > 0 ? "+" : ""}{Math.round(c.net * 100)}</span> · </> : null}
                            {formatCount(c.classified)} classified{c.coverage !== null && ` (${pct(c.coverage)} of collected)`}
                          </span>
                        </div>
                        {c.classified > 0 ? (
                          <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img"
                            aria-label={`${s.name}: ${c.negative} negative, ${middle} neutral, mixed or unclear, ${c.positive} positive`}>
                            <span style={{ width: `${(c.negative / c.classified) * 100}%`, background: "var(--sentiment-negative)" }} />
                            <span style={{ width: `${(middle / c.classified) * 100}%`, background: "var(--sentiment-neutral)" }} />
                            <span style={{ width: `${(c.positive / c.classified) * 100}%`, background: "var(--sentiment-positive)" }} />
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">Not classified yet.</p>
                        )}
                        {c.classified > 0 && !c.enough && <p className="text-xs text-muted-foreground">Too few classified mentions to compare yet.</p>}
                      </li>
                    );
                  })}
                </ul>
                <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
                  <li className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: "var(--sentiment-negative)" }} aria-hidden />Negative</li>
                  <li className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: "var(--sentiment-neutral)" }} aria-hidden />Neutral, mixed or unclear</li>
                  <li className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: "var(--sentiment-positive)" }} aria-hidden />Positive</li>
                </ul>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
