import type { Metadata } from "next";
import Link from "next/link";
import { PackagePlus, Rocket, Sparkles } from "lucide-react";
import { getActiveProduct, hasRole, requireWorkspace } from "@/lib/server/session";
import { getMonitoringOverview, type KeywordCoverageRow, type PlatformMonitoring } from "@/lib/server/collection/monitoring-overview";
import { formatInterval } from "@/lib/sources/adaptive";
import { formatRelative, formatUtc } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { BoostForm, CancelBoost, RankingTable, SourceToggle, type RankingRow } from "./monitoring-client";

export const metadata: Metadata = { title: "Smart Monitoring" };

/** Request time (kept outside render bodies for the purity lint rule). */
function requestTime() {
  return Date.now();
}

const STATE: Record<string, { tone: RankingRow["stateTone"]; label: string }> = {
  live: { tone: "positive", label: "Monitoring" },
  partial: { tone: "warning", label: "Monitoring · incomplete" },
  failing: { tone: "negative", label: "Problem" },
  not_started: { tone: "info", label: "Waiting for first check" },
};

function toRow(p: PlatformMonitoring, now: number, planName: string, planMin: number, paidNote: string | null): RankingRow {
  const r = p.ranking;
  const st = STATE[p.state] ?? STATE.not_started!;
  const next = p.nextScanAt ? new Date(p.nextScanAt).getTime() : null;
  return {
    id: p.id, name: p.name, paid: p.paid,
    rank: r?.phase === "ranked" ? r.rank : null,
    learning: !r || r.phase === "discovery",
    score: r?.phase === "ranked" ? r.score : null,
    mentions7d: p.mentions7d,
    trend: r?.trend ?? "new",
    growthPct: r?.growthPct ?? null,
    interval: p.intervalMinutes ? formatInterval(p.intervalMinutes) : "—",
    next: next === null ? "—" : next <= now ? "Due now" : formatRelative(new Date(next), new Date(now)),
    nextUtc: p.nextScanAt ? formatUtc(p.nextScanAt) : null,
    last: p.lastScanAt ? formatRelative(new Date(p.lastScanAt), new Date(now)) : "Not yet",
    lastUtc: p.lastScanAt ? formatUtc(p.lastScanAt) : null,
    confidence: p.confidence,
    completeSharePct: p.completeShare === null ? null : Math.round(p.completeShare * 100),
    incomplete: p.confidence !== "high" || p.state === "partial" || p.state === "failing",
    stateLabel: st.label, stateTone: st.tone, stateDetail: p.state !== "live" ? p.stateDetail ?? null : null,
    rankText: r?.rankText ?? `${p.name} hasn't been scored yet. It is ranked after its first checks.`,
    intervalText: r?.intervalText ?? null,
    components: (r?.components ?? []).map((c) => ({ id: c.id, label: c.label, points: c.points, measured: c.value !== null, detail: c.detail })),
    reasons: p.reasons,
    // The plan limit is already in the explanation when it sets the interval.
    planNote: [r?.planLimited ? null : `Your ${planName} plan checks each platform at most every ${formatInterval(planMin)}.`, p.paid ? paidNote : null]
      .filter(Boolean).join(" ") || null,
    discovery: p.discovery ? `About ${formatInterval(p.discovery.typical)} typically, at most ${formatInterval(p.discovery.worst)}` : null,
    saturated: p.saturatedRecently,
    failures: p.failures,
    keywords: p.keywords,
    toggle: Boolean(p.toggle),
  };
}

export default async function MonitoringPage() {
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  if (!product) {
    return (
      <>
        <PageHeader title="Smart Monitoring" />
        <EmptyState icon={PackagePlus} title="Add a product first" action={{ href: "/onboarding/product", label: "Add product" }}>
          Monitoring runs per product.
        </EmptyState>
      </>
    );
  }
  const o = await getMonitoringOverview(product.id, workspace.id);
  const canEdit = hasRole(workspace.role, "admin");
  const now = requestTime();
  const runnable = (p: PlatformMonitoring) => p.groups > 0 && p.state !== "not_configured" && p.state !== "not_enabled";
  const active = o.platforms.filter(runnable);
  const available = o.platforms.filter((p) => !runnable(p));
  const paidNote = o.paid.allowanceUsedPercent !== null ? `Paid-source allowance used this month: ${o.paid.allowanceUsedPercent}%.` : null;
  const rows = active.map((p) => toRow(p, now, o.plan.name, o.plan.minIntervalMinutes, paidNote));
  const boosts = o.boosts.filter((b) => !b.canceled_at && new Date(b.ends_at).getTime() > now);
  const pastBoosts = o.boosts.filter((b) => b.canceled_at || new Date(b.ends_at).getTime() <= now).slice(0, 5);
  const eff = o.summary.efficiency;
  const conflicts = active.filter((p) => p.keywordConflict).map((p) => ({ id: p.id, text: p.keywordConflict! }));
  const pausedKeywords = o.keywordCoverage.filter((k) => k.paused).length;

  return (
    <>
      <PageHeader
        title="Smart Monitoring"
        description="SignalForge automatically prioritizes platforms based on where your product is being discussed."
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden />
              Smart Monitoring — Automatic
              <Badge tone="positive">On</Badge>
            </CardTitle>
            <CardDescription>
              Nothing to configure. Each platform gets an activity score from the mentions SignalForge has collected, and busier platforms
              are checked more often. Intervals speed up quickly when activity rises and slow down only gradually, never while
              coverage is incomplete. Your {o.plan.name} plan checks each platform at most every {formatInterval(o.plan.minIntervalMinutes)}
              {" "}and targets searching every keyword within {formatInterval(o.plan.keywordTargetMinutes)} (a scheduling target, not a guaranteed discovery time).
              {o.paid.includedInPlan ? " Paid sources are included in your plan." : ""}
              {paidNote ? ` ${paidNote}` : ""}
            </CardDescription>
            {o.allowancePausedUntil && (
              <p className="mt-1 text-[13px] text-warning" role="status">
                This month&apos;s mention allowance is used up. Paid platforms are paused and free platforms are checked at most daily until it
                renews on {formatUtc(o.allowancePausedUntil)}. New mentions found meanwhile are held, not discarded. <Link href="/settings/billing" className="underline">Plan &amp; usage</Link>
              </p>
            )}
            {o.plan.devFloorMinutes !== null && (
              <p className="mt-1 text-xs text-warning">
                Development entitlement active on this server: this workspace may be checked as often as every {formatInterval(o.plan.devFloorMinutes)}.
                API budgets, paid allowances and rate limits still apply. Not available in production.
              </p>
            )}
          </CardHeader>
        </Card>

        <section aria-labelledby="summary" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <h2 id="summary" className="sr-only">Monitoring summary, last 7 days</h2>
          <Stat label="Active platforms" value={String(o.summary.activePlatforms)} />
          <Stat label="Checks completed (7 days)" value={eff.checks.toLocaleString("en-US")} />
          <Stat
            label="Checks avoided vs hourly"
            value={eff.percentFewer === null ? "—" : `${eff.percentFewer}%`}
            hint={eff.percentFewer === null
              ? "Shown after 24 h and 3 checks of monitoring history"
              : `${eff.avoided.toLocaleString("en-US")} of ${eff.hourlyBaseline.toLocaleString("en-US")} hourly checks, over the time each platform was monitored`}
          />
          <Stat
            label="Avg. discovery delay"
            value={o.summary.avgDiscoveryMinutes === null ? "—" : `~${formatInterval(o.summary.avgDiscoveryMinutes)}`}
            hint="Typical time before a new public mention appears (estimate)"
          />
          <Stat label="Interval adjustments (7 days)" value={String(o.summary.intervalChanges7d)} />
          <Stat
            label="Incomplete coverage"
            value={String(o.summary.incompleteCoverage)}
            hint={o.summary.incompleteCoverage === 1 ? "platform not fully covered" : "platforms not fully covered"}
          />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Platform ranking</CardTitle>
            <CardDescription>
              Ranked by activity score (recent and historical relevant mentions, growth, unique authors, engagement and spikes).
              Open a platform for the reasons behind its score and interval.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Nothing is monitored yet. Add keywords in <Link href="/settings/products" className="underline">product settings</Link>.
              </p>
            ) : (
              <RankingTable rows={rows} productId={product.id} canEdit={canEdit} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Keyword coverage</CardTitle>
            <CardDescription>
              Every keyword on every monitored platform that can search it. Where a platform can&apos;t run all its searches each check,
              keywords take turns and keep their own checkpoints, so each turn re-searches everything since the last one. Refresh times are per keyword.
              {" "}Your {o.plan.name} plan targets every keyword within {formatInterval(o.plan.keywordTargetMinutes)} and includes {o.plan.maxKeywords} active
              keyword{o.plan.maxKeywords === 1 ? "" : "s"} per workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {conflicts.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs" role="note">
                <p className="mb-1 font-medium">Where the keyword refresh target can&apos;t be met</p>
                <ul className="grid gap-1" aria-label="Keyword schedule conflicts">
                  {conflicts.map((c) => <li key={c.id}>{c.text}</li>)}
                </ul>
              </div>
            )}
            {pausedKeywords > 0 && (
              <p className="text-xs text-warning">
                {pausedKeywords} keyword{pausedKeywords === 1 ? " is" : "s are"} paused: over your {o.plan.name} plan&apos;s keyword allowance
                ({o.plan.maxKeywords} active per workspace). They are kept; turn others off or <Link href="/settings/billing" className="underline">change plan</Link> to monitor them.
              </p>
            )}
            {o.keywordCoverage.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No keywords yet. Add them in <Link href="/settings/products" className="underline">product settings</Link>.</p>
            ) : (
              <KeywordCoverageList rows={o.keywordCoverage} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>More platforms</CardTitle>
            <CardDescription>
              {o.paid.serverEnabled
                ? "Paid platforms use SignalForge's paid data provider and count toward your plan's paid-source allowance."
                : "Paid platforms are switched off on this server until spending limits are configured."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2" aria-label="Other platforms">
              {available.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3">
                  <div className="grid gap-0.5">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium">{p.name}{p.paid && <Badge>Paid</Badge>}</span>
                    <span className="text-xs text-muted-foreground">{p.toggle?.reason ?? p.stateDetail ?? "Not monitored"}</span>
                  </div>
                  {canEdit && p.toggle && p.toggle.allowed && (
                    <SourceToggle productId={product.id} platform={p.id} name={p.name} enabled={false} paid={p.paid} />
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Rocket className="size-4" aria-hidden />Launch Boost</CardTitle>
            <CardDescription>
              Check selected platforms more often around a launch, update or campaign. Monitoring returns to automatic intervals when the boost ends.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {boosts.length > 0 && (
              <ul className="grid gap-2" aria-label="Active and upcoming boosts">
                {boosts.map((b) => {
                  const live = new Date(b.starts_at).getTime() <= now;
                  return (
                    <li key={b.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3">
                      <div className="grid gap-0.5 text-[13px]">
                        <span className="flex items-center gap-1.5 font-medium">{b.title}<Badge tone={live ? "positive" : "info"}>{live ? "Active" : "Scheduled"}</Badge></span>
                        <span className="text-xs text-muted-foreground">
                          {b.platforms.map((x) => o.platforms.find((p) => p.id === x)?.name ?? x).join(", ")} · until {formatUtc(b.ends_at)}
                          {b.max_paid_checks > 0 && ` · up to ${b.max_paid_checks} paid checks`}
                        </span>
                      </div>
                      {canEdit && <CancelBoost productId={product.id} boostId={b.id} />}
                    </li>
                  );
                })}
              </ul>
            )}
            {canEdit ? (
              <BoostForm
                productId={product.id}
                platforms={active.map((p) => ({ id: p.id, name: p.name, paid: p.paid }))}
                maxPaidChecks={o.paid.maxBoostPaidChecks}
                boostMinHours={Math.round(o.paid.boostMinMinutes / 60)}
              />
            ) : (
              <p className="text-[13px] text-muted-foreground">Only workspace admins can schedule boosts.</p>
            )}
            {pastBoosts.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Recent: {pastBoosts.map((b) => `${b.title} (${b.canceled_at ? "canceled" : "ended"} ${formatRelative(b.canceled_at ?? b.ends_at)})`).join(" · ")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

const KIND_LABEL: Record<string, string> = {
  exact_name: "Product name", domain: "Domain", handle: "Handle", custom: "Phrase", abbreviation: "Abbreviation", misspelling: "Spelling variant",
};

function KeywordCoverageList({ rows }: { rows: KeywordCoverageRow[] }) {
  return (
    <ul className="divide-y rounded-md border" aria-label="Keyword coverage">
      {rows.map((k) => {
        const searched = k.platforms.filter((p) => p.intervalMinutes !== null);
        const missing = k.platforms.filter((p) => p.intervalMinutes === null);
        const intervals = searched.map((p) => p.intervalMinutes!);
        const fastest = intervals.length ? Math.min(...intervals) : null;
        const slowest = intervals.length ? Math.max(...intervals) : null;
        const rotating = searched.some((p) => p.status === "rotating");
        if (k.paused) {
          return (
            <li key={k.term} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px]">
              <span className="font-medium">{k.term}</span>
              <Badge>{KIND_LABEL[k.kind] ?? k.kind}</Badge>
              <Badge tone="warning">Paused — over your plan&apos;s keyword allowance</Badge>
            </li>
          );
        }
        return (
          <li key={k.term}>
            <details className="group">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px] [&::-webkit-details-marker]:hidden">
                <span className="font-medium">{k.term}</span>
                <Badge>{KIND_LABEL[k.kind] ?? k.kind}</Badge>
                <span className="text-xs text-muted-foreground">
                  Searched on {searched.length} of {k.platforms.length} platform{k.platforms.length === 1 ? "" : "s"}
                </span>
                {fastest !== null && (
                  <span className="text-xs tabular">
                    Every {formatInterval(fastest)}{slowest !== fastest ? ` – ${formatInterval(slowest!)}` : ""}
                  </span>
                )}
                {rotating && <Badge tone="info">Takes turns on some platforms</Badge>}
                {missing.length > 0 && <Badge tone="warning">Not searchable on {missing.length}</Badge>}
              </summary>
              <ul className="grid gap-1 px-3 pb-3 text-xs sm:grid-cols-2" aria-label={`${k.term} by platform`}>
                {k.platforms.map((p) => (
                  <li key={p.platform} className="flex items-start justify-between gap-3 rounded border px-2 py-1.5">
                    <span className="grid gap-0.5">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground">
                        {p.status === "covered" || p.status === "duplicate" ? `Found by the "${p.via}" search` : p.detail}
                      </span>
                    </span>
                    <span className={p.intervalMinutes === null ? "shrink-0 text-warning" : "shrink-0 tabular"}>
                      {p.intervalMinutes === null ? "Not searched" : `every ${formatInterval(p.intervalMinutes)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="grid content-start gap-0.5 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </Card>
  );
}
