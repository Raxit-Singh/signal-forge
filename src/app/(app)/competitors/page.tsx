import type { Metadata } from "next";
import { PackagePlus, Plus, Swords } from "lucide-react";
import { CountUp } from "@/components/motion";
import { createClient } from "@/lib/supabase/server";
import { getActiveProduct, getWorkspacePlan, getWorkspaceUsage, hasRole, requireWorkspace } from "@/lib/server/session";
import { getCompetitorComparison } from "@/lib/server/analytics/competitors";
import { MIN_CLASSIFIED_FOR_SENTIMENT } from "@/lib/analytics/competitors";
import { parseRange } from "@/lib/domain/date-range";
import { integrationInfo } from "@/lib/domain/integrations";
import { formatCount, formatTime } from "@/lib/format";
import { getTimeZone } from "@/lib/server/timezone";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/primitives";
import { AddCompetitorForm, CompetitorControls, VolumeChart } from "./competitors-client";

export const metadata: Metadata = { title: "Competitors" };

type SearchParams = Record<string, string | undefined>;
const sourceName = (id: string) => integrationInfo(id as never)?.name.replace(/ \/ Stack Exchange$/, "") ?? id;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export default async function CompetitorsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const tz = await getTimeZone();
  const at = (d: string | Date) => formatTime(d, tz);
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
  const range = parseRange(sp, new Date());
  const supabase = await createClient();
  const [{ data: p }, { plan }, usage, { count: keywordsUsed }] = await Promise.all([
    supabase.from("products").select("created_at").eq("id", product.id).single(),
    getWorkspacePlan(workspace.id),
    getWorkspaceUsage(workspace.id),
    // Keywords in use across the workspace's products and competitors (one shared allowance).
    supabase.from("product_aliases").select("id, products!inner(archived_at)", { count: "exact", head: true })
      .eq("workspace_id", workspace.id).eq("enabled", true).is("products.archived_at", null),
  ]);
  const d = await getCompetitorComparison(supabase, { id: product.id, name: product.name, createdAt: p?.created_at as string }, range, tz);
  const canManage = hasRole(workspace.role, "admin");
  const limit = plan.maxCompetitorsPerProduct;
  // You are always the signal red; competitors take identity colours that can't be confused with it (no orange).
  const RIVALS = ["var(--entity-2)", "var(--entity-4)", "var(--entity-1)", "var(--entity-5)", "var(--entity-6)"];
  const colorOf = new Map(d.entities.filter((e) => e.id !== product.id).map((e, i) => [e.id, RIVALS[i % RIVALS.length]!]));
  colorOf.set(product.id, "var(--signal)");
  const keywordsLeft = Math.max(0, plan.maxKeywords - (keywordsUsed ?? 0));
  const addBlocked = limit === 0
    ? `Your ${plan.name} plan doesn't include competitor tracking.`
    : d.competitors.length >= limit ? `Your ${plan.name} plan includes ${limit} competitor${limit === 1 ? "" : "s"} per product.`
    : keywordsLeft < 1 ? `All ${plan.maxKeywords} of your ${plan.name} plan's keywords are in use. A competitor's name needs one.` : null;
  const active = d.competitors.filter((c) => c.enabled);

  const you = d.voice.find((v) => v.isProduct);
  const anyVoice = d.voice.some((v) => v.share !== null);
  const leader = [...d.voice].sort((a, b) => (b.share ?? 0) - (a.share ?? 0))[0];
  const comparable = active.length > 0 && !d.window.empty && d.sources.common.length > 0;

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 pb-10">
        {/* Hero: your share of the conversation against the competitors you track. */}
        <section className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="rise grid content-start gap-5">
            <div className="grid gap-1.5">
              <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">Competitors</h1>
              <p className="text-[14px] text-muted-foreground">{product.name} compared with competitors you choose · {range.label.toLowerCase()}</p>
            </div>
            {comparable && you?.share != null ? (
              <div className="grid gap-2">
                <span className="text-[13px] text-muted-foreground">Your share of voice</span>
                <CountUp value={Math.round(you.share * 100)} suffix="%" className="text-[56px] font-semibold leading-none tracking-[-0.045em] sm:text-[64px]" />
                <p className="text-[14px] text-muted-foreground">
                  {leader && leader.id !== you.id
                    ? <>{leader.name} leads with <span className="text-signal">{pct(leader.share ?? 0)}</span></>
                    : <>You lead the conversation</>}
                  {" "}· {active.length} competitor{active.length === 1 ? "" : "s"} · {d.sources.common.length} shared source{d.sources.common.length === 1 ? "" : "s"}
                </p>
              </div>
            ) : (
              <p className="max-w-[48ch] text-[14px] text-muted-foreground">
                Add competitors to see who owns the conversation: share of voice, daily volume and sentiment, measured on the same sources over the same time.
              </p>
            )}
            {canManage && (
              <a href="#add-competitor" className="press flex h-11 w-fit items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_8px_24px_-8px_color-mix(in_oklab,var(--signal)_80%,transparent)]">
                <Plus className="size-4" aria-hidden />Add competitor
              </a>
            )}
          </div>

          {comparable ? (
            <section className="rise grid content-end gap-4" style={{ ["--d" as string]: "120ms" }} data-testid="share-of-voice" aria-label="Share of voice">
              <div className="flex items-baseline justify-between gap-3 text-[13px] text-muted-foreground">
                <span>Share of voice</span>
                <span>{d.sources.common.map(sourceName).join(", ")}</span>
              </div>
              {anyVoice && (
                <div className="flex h-[96px] items-end gap-2" aria-hidden>
                  {d.voice.filter((v) => (v.share ?? 0) > 0).map((v, i) => (
                    <div key={v.id} className="grow-y relative grid h-full min-w-0 content-end rounded-2xl p-3"
                      style={{ flex: Math.max(v.share ?? 0, 0.06), ["--d" as string]: `${300 + i * 100}ms`,
                        background: v.isProduct ? "linear-gradient(180deg, color-mix(in oklab, var(--signal) 80%, white), var(--signal))" : `repeating-linear-gradient(90deg, ${colorOf.get(v.id)} 0 5px, transparent 5px 10px)`,
                        boxShadow: v.isProduct ? "0 10px 40px -10px color-mix(in oklab, var(--signal) 70%, transparent)" : undefined }}>
                      <span className={`w-fit rounded-full px-2 py-0.5 text-[12px] font-semibold ${v.isProduct ? "text-white" : "bg-background/85"}`}>{pct(v.share ?? 0)}</span>
                    </div>
                  ))}
                </div>
              )}
              <ul className="grid gap-1" aria-label="Share of voice">
                {d.voice.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: v.isProduct ? "var(--signal)" : colorOf.get(v.id), boxShadow: v.isProduct ? "var(--signal-glow)" : undefined }} aria-hidden />
                      <span className="truncate">{v.name}</span>{v.isProduct && <span className="text-[12px] text-muted-foreground">(you)</span>}
                    </span>
                    <span className="shrink-0 tabular text-muted-foreground">
                      {formatCount(v.mentions)} mention{v.mentions === 1 ? "" : "s"}{v.share !== null && <> · <span className="font-medium text-foreground">{pct(v.share)}</span></>}
                    </span>
                  </li>
                ))}
              </ul>
              {!anyVoice && <p className="text-[12px] text-muted-foreground">No relevant mentions for anyone in this period yet.</p>}
              <p className="text-[12px] text-muted-foreground/80">
                Relevant mentions from {at(d.window.from.toISOString())}.
                {d.window.clamped && " The period starts when the most recently added competitor began to be tracked, so every product is measured over the same time."}
              </p>
              {d.sources.excluded.length > 0 && (
                <details className="text-[12px] text-muted-foreground/80">
                  <summary className="cursor-pointer hover:text-foreground">{d.sources.excluded.length} source{d.sources.excluded.length === 1 ? "" : "s"} not compared (not monitored for everyone)</summary>
                  <p className="mt-1" data-testid="excluded-sources">
                    Not compared: {d.sources.excluded.map((x) => `${sourceName(x.source)} (not monitored for ${x.missingFor.join(", ")})`).join("; ")}.
                  </p>
                </details>
              )}
            </section>
          ) : (
            <div className="rise grid place-content-center rounded-[18px] border border-dashed p-8 text-center" style={{ ["--d" as string]: "120ms" }}>
              <Swords className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden />
              <p className="text-[15px] font-medium">
                {active.length === 0 ? "No comparison yet" : d.window.empty ? "Nothing to compare in this period" : "No source is monitored for all of them"}
              </p>
              <p className="mt-1 max-w-[46ch] text-[13px] text-muted-foreground">
                {active.length === 0
                  ? `Add a competitor to compare share of voice, mention volume and sentiment with ${product.name}.`
                  : d.window.empty
                    ? "The selected period ends before your competitors were being tracked. Choose a more recent period."
                    : `Comparisons only use sources searched for ${product.name} and every competitor. Searches are still being set up, or the products are monitored on different sources.`}
              </p>
            </div>
          )}
        </section>

        {comparable && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-12">
            <section className="panel rise grid content-start gap-4 rounded-[18px] p-5 xl:col-span-8" style={{ ["--d" as string]: "240ms" }}>
              <div className="grid gap-1">
                <h2 className="text-[13px] text-muted-foreground">Mention volume</h2>
                <p className="text-[12px] text-muted-foreground/80">Relevant mentions per day on the compared sources.</p>
              </div>
              <VolumeChart rows={d.daily} entities={d.entities.map((e) => ({ id: e.id, name: e.name, color: e.id === product.id ? "var(--signal)" : colorOf.get(e.id)!, you: e.id === product.id }))} />
            </section>

            <section className="panel rise grid content-start gap-4 rounded-[18px] p-5 xl:col-span-4" style={{ ["--d" as string]: "300ms" }}>
              <div className="grid gap-1">
                <h2 className="text-[13px] text-muted-foreground">Sentiment</h2>
                <p className="text-[12px] text-muted-foreground/80">
                  Toward each product, over its classified mentions. Net = positive minus negative; shown from {MIN_CLASSIFIED_FOR_SENTIMENT} classified.
                </p>
              </div>
              <ul className="grid gap-4" aria-label="Sentiment by product" data-testid="competitor-sentiment">
                {d.sentiment.map((s) => {
                  const c = s.summary;
                  const middle = c.neutral + c.mixed + c.uncertain;
                  return (
                    <li key={s.id} className="grid gap-2 text-[13px]">
                      <div className="flex items-end justify-between gap-2">
                        <span className="grid">
                          <span className="font-medium">{s.name}{s.isProduct && <span className="ml-1 text-[12px] font-normal text-muted-foreground">(you)</span>}</span>
                          <span className="text-[11px] text-muted-foreground">{formatCount(c.classified)} classified{c.coverage !== null && ` (${pct(c.coverage)} of collected)`}</span>
                        </span>
                        {c.net !== null && (
                          <span className={`text-[22px] font-semibold leading-none tracking-[-0.03em] tabular ${c.net < 0 ? "text-signal" : ""}`} title="Net sentiment">
                            {c.net > 0 ? "+" : ""}{Math.round(c.net * 100)}
                          </span>
                        )}
                      </div>
                      {c.classified > 0 ? (
                        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img"
                          aria-label={`${s.name}: ${c.negative} negative, ${middle} neutral, mixed or unclear, ${c.positive} positive`}>
                          <span className="rounded-full bg-signal" style={{ width: `${(c.negative / c.classified) * 100}%` }} />
                          <span className="rounded-full bg-foreground/20" style={{ width: `${(middle / c.classified) * 100}%` }} />
                          <span className="rounded-full bg-foreground/75" style={{ width: `${(c.positive / c.classified) * 100}%` }} />
                        </div>
                      ) : (
                        <p className="text-[12px] text-muted-foreground">Not classified yet.</p>
                      )}
                      {c.classified > 0 && !c.enough && <p className="text-[12px] text-muted-foreground">Too few classified mentions to compare yet.</p>}
                    </li>
                  );
                })}
              </ul>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground" aria-label="Legend">
                <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-signal" aria-hidden />Negative</li>
                <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-foreground/20" aria-hidden />Neutral, mixed or unclear</li>
                <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-foreground/75" aria-hidden />Positive</li>
              </ul>
            </section>
          </div>
        )}

        {/* Tracked competitors and adding new ones. */}
        <section className="grid gap-3 pt-2" aria-labelledby="tracked">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="grid gap-1">
              <h2 id="tracked" className="text-[24px] font-medium tracking-[-0.03em]">Tracked competitors</h2>
              <p className="max-w-[80ch] text-[12px] text-muted-foreground">
                Each competitor is searched on the same sources as {product.name}, on its own schedule. Their mentions count toward your monthly
                mention allowance. {limit > 0 && <>{d.competitors.length} of {limit} used.</>}
              </p>
            </div>
          </div>
          {d.competitors.length > 0 && (
            <ul className="grid gap-3 lg:grid-cols-2" aria-label="Competitors">
              {d.competitors.map((c, i) => (
                <li key={c.id} className="panel rise grid content-between gap-4 rounded-[18px] p-5 text-[13px]" style={{ ["--d" as string]: `${360 + i * 50}ms` }} data-testid="competitor">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold text-background"
                      style={{ background: c.enabled && c.trackingProductId ? colorOf.get(c.trackingProductId) : "color-mix(in oklab, var(--foreground) 35%, transparent)" }} aria-hidden>
                      {c.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="grid min-w-0 flex-1 gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-medium">{c.name}</span>
                        {c.enabled ? <Badge tone="positive">Tracking</Badge> : <Badge tone="neutral">Paused</Badge>}
                      </div>
                      <span className="text-[12px] text-muted-foreground">
                        Searches: {c.keywords.map((k) => `“${k}”`).join(", ")} · since {at(c.trackedSince!)}
                        {c.websiteUrl && <> · <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{c.websiteUrl.replace(/^https?:\/\//, "")}</a></>}
                      </span>
                    </div>
                  </div>
                  {canManage && <div className="border-t border-foreground/[0.06] pt-3"><CompetitorControls c={c} /></div>}
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <div id="add-competitor" className="panel scroll-mt-20 rounded-[18px] p-5">
              <AddCompetitorForm productId={product.id} disabledReason={addBlocked} keywordsLeft={limit > 0 ? keywordsLeft : null}
                mentionsLeft={usage?.mentionsRemaining ?? null} historyDays={plan.historyDays} />
            </div>
          ) : d.competitors.length === 0 && <p className="text-[13px] text-muted-foreground">No competitors yet. Ask a workspace admin to add some.</p>}
        </section>
      </div>
    </>
  );
}
