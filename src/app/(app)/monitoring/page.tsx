import type { Metadata } from "next";
import Link from "next/link";
import { Gauge, PackagePlus, Rocket } from "lucide-react";
import { getActiveProduct, getWorkspacePlan, hasRole, requireWorkspace } from "@/lib/server/session";
import { getMonitoringOverview, type PlatformMonitoring } from "@/lib/server/collection/monitoring-overview";
import { formatRelative, formatUtc } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { BoostForm, CancelBoost, ModeForm, SourceToggle } from "./monitoring-client";

export const metadata: Metadata = { title: "Smart Monitoring" };

const hours = (m: number) => (m < 60 ? `${m} min` : `${Math.round(m / 60)} h`);
const STATE: Record<string, { tone: "positive" | "warning" | "negative" | "neutral" | "info"; label: string }> = {
  live: { tone: "positive", label: "Monitoring" },
  partial: { tone: "warning", label: "Monitoring · incomplete" },
  failing: { tone: "negative", label: "Problem" },
  not_configured: { tone: "neutral", label: "Not configured" },
  not_enabled: { tone: "neutral", label: "Off" },
  not_started: { tone: "info", label: "Waiting for first check" },
};
/** Request time (kept outside render bodies for the purity lint rule). */
function requestTime() {
  return Date.now();
}

const CONF: Record<string, "positive" | "warning" | "negative"> = { high: "positive", medium: "warning", low: "negative" };

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
  const [o, { plan }] = await Promise.all([getMonitoringOverview(product.id, workspace.id), getWorkspacePlan(workspace.id)]);
  const canEdit = hasRole(workspace.role, "admin");
  const active = o.platforms.filter((p) => p.groups > 0);
  const available = o.platforms.filter((p) => p.groups === 0);
  const now = requestTime();
  const boosts = o.boosts.filter((b) => !b.canceled_at && new Date(b.ends_at).getTime() > now);
  const pastBoosts = o.boosts.filter((b) => b.canceled_at || new Date(b.ends_at).getTime() <= now).slice(0, 5);

  return (
    <>
      <PageHeader
        title="Smart Monitoring"
        description={<>How often each platform is checked for {product.name}, and why. Intervals adapt to activity, coverage and cost.</>}
      />
      <div className="grid gap-6">
        <section aria-labelledby="eff" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <h2 id="eff" className="sr-only">Monitoring efficiency, last 7 days</h2>
          <Stat label="Checks run (7 days)" value={o.efficiency.checks7d.toLocaleString()} />
          <Stat
            label="Fewer checks than hourly polling"
            value={o.efficiency.hourlyEquivalent ? `${o.efficiency.percentFewer}%` : "—"}
            hint={o.efficiency.hourlyEquivalent ? `${o.efficiency.avoided.toLocaleString()} of ${o.efficiency.hourlyEquivalent.toLocaleString()} hourly checks avoided since monitoring started` : "No checks have run yet"}
          />
          <Stat label="Shared fetches" value={o.efficiency.sharedFetches.toLocaleString()} hint="Checks served by an identical query" />
          <Stat label="Interval adjustments" value={o.efficiency.intervalChanges.toLocaleString()} hint="Times a check interval changed" />
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Monitoring mode</CardTitle>
            <CardDescription>Applies to every platform of this product. Launch Boost can temporarily go faster.</CardDescription>
          </CardHeader>
          <CardContent>
            <ModeForm
              productId={product.id}
              mode={o.mode}
              canEdit={canEdit}
              planNote={`Your ${plan.name} plan checks each source at most every ${hours(plan.monitoringIntervalMinutes)}. ${
                o.paid.includedInPlan ? "Paid sources are included." : "Paid sources are not included in this plan."
              }${o.paid.allowanceUsedPercent !== null ? ` Paid-source allowance used this month: ${o.paid.allowanceUsedPercent}%.` : ""}`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platforms being monitored</CardTitle>
            <CardDescription>
              Expected discovery is how long a new public mention typically takes to appear here. No source is guaranteed complete.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {active.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Nothing is monitored yet. Add keywords in <Link href="/settings/products" className="underline">product settings</Link>.</p>
            ) : (
              <ul className="divide-y rounded-md border" aria-label="Monitored platforms">
                {active.map((p) => <PlatformRow key={p.id} p={p} productId={product.id} canEdit={canEdit} now={now} />)}
              </ul>
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
              Check selected platforms more often around a launch, update or campaign. Monitoring returns to normal automatically when the boost ends.
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
                          {b.platforms.map((x) => o.platforms.find((p) => p.id === x)?.name ?? x).join(", ")} · {b.mode} · until {formatUtc(b.ends_at)}
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
                platforms={active.filter((p) => p.state !== "not_configured").map((p) => ({ id: p.id, name: p.name, paid: p.paid }))}
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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="grid gap-0.5 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </Card>
  );
}

function PlatformRow({ p, productId, canEdit, now }: { p: PlatformMonitoring; productId: string; canEdit: boolean; now: number }) {
  const st = STATE[p.state] ?? STATE.not_started!;
  return (
    <li className="grid gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{p.name}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
        {p.paid && <Badge>Paid</Badge>}
        {p.confidence && <Badge tone={CONF[p.confidence]}><Gauge className="size-3" aria-hidden />Coverage confidence: {p.confidence}</Badge>}
        {p.saturatedRecently && <Badge tone="warning">Hit page limit recently</Badge>}
        {p.failures > 0 && <Badge tone="negative">{p.failures} failed check{p.failures === 1 ? "" : "s"}</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5">
        <div><dt className="text-muted-foreground">Checks every</dt><dd className="tabular">{p.intervalMinutes ? hours(p.intervalMinutes) : "not set yet"}</dd></div>
        <div><dt className="text-muted-foreground">Last check</dt><dd title={p.lastScanAt ? formatUtc(p.lastScanAt) : undefined}>{p.lastScanAt ? formatRelative(p.lastScanAt) : "—"}</dd></div>
        <div><dt className="text-muted-foreground">Next check</dt><dd title={p.nextScanAt ? formatUtc(p.nextScanAt) : undefined}>{p.nextScanAt && p.state !== "not_configured" ? (new Date(p.nextScanAt).getTime() <= now ? "due now" : formatRelative(p.nextScanAt)) : "—"}</dd></div>
        <div><dt className="text-muted-foreground">Expected discovery</dt><dd>{p.discovery && p.state !== "not_configured" ? `~${hours(p.discovery.typical)}, at most ${hours(p.discovery.worst)}` : "—"}</dd></div>
        <div><dt className="text-muted-foreground">Relevant mentions (7 days)</dt><dd className="tabular">{p.mentions7d}</dd></div>
      </dl>
      {p.reasons.length > 0 && (
        <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Why this interval:</span> {p.reasons.join("; ")}.</p>
      )}
      {p.stateDetail && p.state !== "live" && <p className="text-xs text-warning">{p.stateDetail}</p>}
      {(p.searched.length > 0 || p.skipped.length > 0) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Keywords on {p.name}</summary>
          <div className="mt-1 grid gap-1">
            {p.searched.length > 0 && <p>Searched: {p.searched.join(", ")}</p>}
            {p.skipped.map((s) => <p key={s.term} className="text-muted-foreground">“{s.term}”: {s.detail}</p>)}
          </div>
        </details>
      )}
      {canEdit && p.toggle && (
        <div className="w-fit"><SourceToggle productId={productId} platform={p.id} name={p.name} enabled paid={p.paid} /></div>
      )}
    </li>
  );
}
