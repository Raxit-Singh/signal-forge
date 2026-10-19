"use client";

import { Fragment, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, Minus, Sparkle } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import type { SkippedKeyword } from "@/lib/sources/query-optimizer";
import { cancelBoostAction, createBoostAction, setSourceEnabledAction } from "@/app/actions/monitoring";
import { FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { Input, Label } from "@/components/ui/primitives";
import { idle } from "@/lib/action-state";
import { cn } from "@/lib/utils";

export function SourceToggle({ productId, platform, name, enabled, paid, disabledReason }: {
  productId: string; platform: string; name: string; enabled: boolean; paid: boolean; disabledReason?: string;
}) {
  const [state, action] = useFormAction(setSourceEnabledAction, idle);
  const [confirm, setConfirm] = useState(false);
  return (
    <form action={action} className="grid gap-1.5">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="platform" value={platform} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      {!enabled && paid && !disabledReason && (
        <label className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" name="confirmPaid" value="yes" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
          <span>I authorize paid checks on {name} within my plan&apos;s paid-source allowance.</span>
        </label>
      )}
      <SubmitButton
        size="sm"
        variant={enabled ? "secondary" : "default"}
        disabled={Boolean(disabledReason) || (!enabled && paid && !confirm)}
        aria-label={`${enabled ? "Turn off" : "Turn on"} ${name}`}
        pendingLabel="Saving…"
      >
        {enabled ? "Turn off" : "Turn on"}
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function BoostForm({ productId, platforms, maxPaidChecks, boostMinHours }: {
  productId: string;
  platforms: Array<{ id: string; name: string; paid: boolean }>;
  maxPaidChecks: number;
  boostMinHours: number;
}) {
  const [state, action] = useFormAction(createBoostAction, idle);
  const [picked, setPicked] = useState<string[]>([]);
  const paidPicked = platforms.filter((p) => p.paid && picked.includes(p.id));
  const now = new Date();
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="tzOffsetMinutes" value={now.getTimezoneOffset()} />
      <div className="grid gap-1.5">
        <Label htmlFor="boost-title">Name</Label>
        <Input id="boost-title" name="title" placeholder="v2.0 launch" maxLength={120} required defaultValue={state.status === "error" ? state.values?.title : undefined} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="boost-start">Starts</Label>
          <Input id="boost-start" name="startsAt" type="datetime-local" required defaultValue={local(now)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="boost-end">Ends (max 14 days)</Label>
          <Input id="boost-end" name="endsAt" type="datetime-local" required defaultValue={local(new Date(now.getTime() + 3 * 86_400_000))} />
        </div>
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-[13px] font-medium">Platforms</legend>
        {platforms.length === 0 ? (
          <p className="text-xs text-muted-foreground">No platforms are monitored for this product yet.</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {platforms.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-[13px]">
                <input
                  type="checkbox" name="platforms" value={p.id} checked={picked.includes(p.id)}
                  onChange={(e) => setPicked((xs) => (e.target.checked ? [...xs, p.id] : xs.filter((x) => x !== p.id)))}
                />
                {p.name}{p.paid && <span className="text-xs text-muted-foreground">(paid)</span>}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        {boostMinHours >= 3
          ? `During the boost, selected platforms are checked every ${boostMinHours} h (the fastest a boost allows on your plan).`
          : `During the boost, selected platforms are checked at least every 3 h, and as often as every ${boostMinHours} h when activity is high.`}
      </p>
      {paidPicked.length > 0 && (
        <div className={cn("grid gap-2 rounded-md border border-warning/40 bg-warning/8 p-3")}>
          <div className="grid gap-1.5">
            <Label htmlFor="boost-paid">Extra paid checks allowed (max {maxPaidChecks})</Label>
            <Input id="boost-paid" name="maxPaidChecks" type="number" min={1} max={maxPaidChecks} defaultValue={Math.min(50, maxPaidChecks)} className="w-32" />
          </div>
          <label className="flex items-start gap-1.5 text-xs">
            <input type="checkbox" name="confirmPaid" value="yes" className="mt-0.5" />
            <span>I authorize up to this many paid checks on {paidPicked.map((p) => p.name).join(", ")} during the boost. They count toward the plan&apos;s paid-source allowance and stop when either limit is reached.</span>
          </label>
        </div>
      )}
      <div><SubmitButton size="sm" pendingLabel="Scheduling…" disabled={picked.length === 0}>Schedule boost</SubmitButton></div>
      <FormMessage state={state} />
    </form>
  );
}

export function CancelBoost({ productId, boostId }: { productId: string; boostId: string }) {
  const [state, action] = useFormAction(cancelBoostAction, idle);
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="boostId" value={boostId} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Canceling…">Cancel</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export interface RankingRow {
  id: string;
  name: string;
  paid: boolean;
  rank: number | null;
  learning: boolean;
  score: number | null;
  /** V2: share of this product's relevant mentions (%), relevant/day, overflow risk. */
  sharePct: number | null;
  arrivalPerDay: number | null;
  risk: "none" | "watch" | "at_risk" | "unavoidable" | null;
  riskDetail: string | null;
  mentions7d: number;
  trend: "rising" | "stable" | "falling" | "new" | "unknown";
  growthPct: number | null;
  interval: string;
  /** Effective keyword refresh when keywords take turns (differs from the platform interval). */
  keywordInterval: string | null;
  keywordConflict: string | null;
  next: string;
  nextAt: string | null;
  last: string;
  lastAt: string | null;
  confidence: "high" | "medium" | "low" | null;
  completeSharePct: number | null;
  incomplete: boolean;
  stateLabel: string;
  stateTone: "positive" | "warning" | "negative" | "neutral" | "info";
  stateDetail: string | null;
  rankText: string;
  intervalText: string | null;
  components: Array<{ id: string; label: string; points: number; measured: boolean; detail: string }>;
  reasons: string[];
  planNote: string | null;
  discovery: string | null;
  saturated: boolean;
  failures: number;
  keywords: { searched: string[]; searches: number; searchesPerCheck: number; rotating: number; combined: boolean; skipped: SkippedKeyword[]; productOnly: boolean };
  toggle: boolean;
}

const CONF_TONE = { high: "positive", medium: "warning", low: "negative" } as const;
const CONF_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

function Trend({ r }: { r: RankingRow }) {
  const pct = r.growthPct !== null && Math.abs(r.growthPct) >= 1 ? ` ${r.growthPct > 0 ? "+" : ""}${r.growthPct}%` : "";
  switch (r.trend) {
    case "rising": return <span className="inline-flex items-center gap-1 text-positive"><ArrowUpRight className="size-3.5" aria-hidden />Rising{pct}</span>;
    case "falling": return <span className="inline-flex items-center gap-1 text-negative"><ArrowDownRight className="size-3.5" aria-hidden />Falling{pct}</span>;
    case "stable": return <span className="inline-flex items-center gap-1 text-muted-foreground"><ArrowRight className="size-3.5" aria-hidden />Stable{pct}</span>;
    case "new": return <span className="inline-flex items-center gap-1 text-muted-foreground"><Sparkle className="size-3.5" aria-hidden />New</span>;
    default: return <span className="inline-flex items-center gap-1 text-muted-foreground" title="Not enough complete coverage of earlier weeks"><Minus className="size-3.5" aria-hidden />Unknown</span>;
  }
}

function Score({ r }: { r: RankingRow }) {
  if (r.learning) return <span className="text-muted-foreground">Learning</span>;
  if (r.sharePct !== null) {
    return (
      <span className="inline-flex items-center gap-2" title="Share of this product's relevant mentions over the last 4 weeks">
        <span className="tabular font-medium">{r.sharePct}%</span>
        <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted sm:inline-block" aria-hidden>
          <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, r.sharePct)}%` }} />
        </span>
      </span>
    );
  }
  if (r.score === null) return <span className="text-muted-foreground">Learning</span>;
  return <span className="tabular font-medium">{r.score}<span className="text-muted-foreground">/100</span></span>;
}

const RISK_LABEL = { watch: "Busy — watched closely", at_risk: "Overflow risk", unavoidable: "More than checks can read" } as const;

function Coverage({ r }: { r: RankingRow }) {
  if (!r.confidence) return <span className="text-muted-foreground">—</span>;
  return <Badge tone={CONF_TONE[r.confidence]}>{CONF_LABEL[r.confidence]}</Badge>;
}

function Details({ r, productId, canEdit }: { r: RankingRow; productId: string; canEdit: boolean }) {
  const kw = r.keywords;
  return (
    <div className="grid gap-4 text-[13px] md:grid-cols-2">
      <div className="grid content-start gap-3">
        <section className="grid gap-1">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why this rank</h4>
          <p>{r.rankText}</p>
          {r.components.length > 0 && (
            <p className="mt-1 text-xs font-medium text-muted-foreground">Measured signals (context; intervals come from arrival rates)</p>
          )}
          {r.components.length > 0 && (
            <ul className="grid gap-0.5 text-xs" aria-label={`${r.name} measured signals`}>
              {r.components.map((c) => (
                <li key={c.id} className="flex justify-between gap-3">
                  <span className={c.measured ? "" : "text-muted-foreground"} title={c.detail}>
                    {c.label}<span className="text-muted-foreground"> · {c.detail}</span>
                  </span>
                  <span className="shrink-0 tabular text-muted-foreground">{c.measured ? (c.points < 0 ? `−${Math.abs(c.points)}` : `+${c.points}`) : "not measured"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="grid gap-1">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Why this interval</h4>
          {r.intervalText && <p>{r.intervalText}</p>}
          {r.keywordInterval && <p>Each keyword is searched every {r.keywordInterval}: keywords take turns within the plan&apos;s searches per check.</p>}
          {r.keywordConflict && <p className="text-warning">{r.keywordConflict}</p>}
          {r.reasons.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-muted-foreground">
              {r.reasons.map((x) => <li key={x}>{x}</li>)}
            </ul>
          )}
          {r.planNote && <p className="text-xs text-muted-foreground">{r.planNote}</p>}
        </section>
      </div>
      <div className="grid content-start gap-3">
        <section className="grid gap-1">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Coverage</h4>
          <p className="flex flex-wrap items-center gap-1.5">
            <Badge tone={r.stateTone}>{r.stateLabel}</Badge>
            {r.paid && <Badge>Paid</Badge>}
            {r.saturated && <Badge tone="warning">Hit page limit recently</Badge>}
            {r.risk && r.risk !== "none" && <Badge tone={r.risk === "watch" ? "info" : "warning"}>{RISK_LABEL[r.risk]}</Badge>}
            {r.failures > 0 && <Badge tone="negative">{r.failures} failed check{r.failures === 1 ? "" : "s"}</Badge>}
          </p>
          {r.riskDetail && <p className="text-xs text-warning">{r.riskDetail}</p>}
          {r.arrivalPerDay !== null && !r.learning && (
            <p className="text-xs">About {r.arrivalPerDay >= 10 ? Math.round(r.arrivalPerDay) : r.arrivalPerDay} relevant mention{r.arrivalPerDay === 1 ? "" : "s"} a day here (estimated from recent checks).</p>
          )}
          {r.completeSharePct !== null && (
            <p className="text-xs">{r.completeSharePct}% of the last 7 days was covered by complete checks.</p>
          )}
          {r.incomplete && (
            <p className="text-xs text-warning">Coverage is incomplete, so a low mention count here doesn&apos;t prove the platform is quiet.</p>
          )}
          {r.stateDetail && <p className="text-xs text-muted-foreground">{r.stateDetail}</p>}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div><dt className="text-muted-foreground">Last checked</dt><dd title={r.lastAt ?? undefined}>{r.last}</dd></div>
            <div><dt className="text-muted-foreground">Next check</dt><dd title={r.nextAt ?? undefined}>{r.next}</dd></div>
            {r.discovery && <div className="col-span-2"><dt className="text-muted-foreground">Expected discovery</dt><dd>{r.discovery}</dd></div>}
          </dl>
        </section>
        <section className="grid gap-1">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Keywords on {r.name}</h4>
          {kw.productOnly ? (
            <p className="text-xs">Collects reviews of your product&apos;s own page; keywords aren&apos;t used.</p>
          ) : (
            <>
              <p className="text-xs">
                {kw.searched.length > 0 ? <>Searched: {kw.searched.join(", ")}</> : "No keywords searched"}
                <span className="text-muted-foreground">
                  {" "}· {kw.searches} search{kw.searches === 1 ? "" : "es"}{kw.combined ? " (keywords combined)" : ""}
                  {kw.rotating > 0 ? `; ${kw.rotating} keyword${kw.rotating === 1 ? "" : "s"} take turns (about ${kw.searchesPerCheck} searches per check)` : ""}
                </span>
              </p>
              {kw.skipped.map((s) => <p key={s.term} className="text-xs text-muted-foreground">“{s.term}”: {s.detail}</p>)}
            </>
          )}
        </section>
        {canEdit && r.toggle && (
          <div className="w-fit"><SourceToggle productId={productId} platform={r.id} name={r.name} enabled paid={r.paid} /></div>
        )}
      </div>
    </div>
  );
}

/** Ranked platforms (desktop table, mobile cards) with expandable explanations. */
export function RankingTable({ rows, productId, canEdit }: { rows: RankingRow[]; productId: string; canEdit: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const ranked = rows.filter((r) => !r.learning).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const learning = rows.filter((r) => r.learning).sort((a, b) => a.name.localeCompare(b.name));
  const ordered = [...ranked, ...learning];
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));

  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-[13px]" aria-label="Platform ranking">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-2 font-medium">Rank</th>
              <th scope="col" className="py-2 pr-2 font-medium">Platform</th>
              <th scope="col" className="py-2 pr-2 font-medium">Share of activity</th>
              <th scope="col" className="py-2 pr-2 text-right font-medium">Mentions (7 days)</th>
              <th scope="col" className="py-2 pr-2 font-medium">Trend</th>
              <th scope="col" className="py-2 pr-2 font-medium">Refresh interval</th>
              <th scope="col" className="py-2 pr-2 font-medium">Next scan</th>
              <th scope="col" className="py-2 font-medium">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((r, i) => (
              <Fragment key={r.id}>
                {r.learning && (i === 0 || !ordered[i - 1]!.learning) && (
                  <tr><td colSpan={8} className="pb-1 pt-3 text-xs font-medium text-muted-foreground">New platforms (learning, not ranked yet)</td></tr>
                )}
                <tr className={cn("border-b align-middle", open === r.id && "border-b-0 bg-muted/40")}>
                  <td className="py-2 pr-2 tabular font-medium">{r.rank !== null ? `#${r.rank}` : <Badge tone="info">New</Badge>}</td>
                  <td className="py-2 pr-2">
                    <button
                      type="button"
                      onClick={() => toggle(r.id)}
                      aria-expanded={open === r.id}
                      aria-controls={`details-${r.id}`}
                      className="inline-flex items-center gap-1 rounded font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <ChevronDown className={cn("size-3.5 transition-transform", open === r.id && "rotate-180")} aria-hidden />
                      {r.name}
                    </button>
                    {r.paid && <Badge className="ml-1.5">Paid</Badge>}
                  </td>
                  <td className="py-2 pr-2"><Score r={r} /></td>
                  <td className="py-2 pr-2 text-right tabular">{r.mentions7d.toLocaleString("en-US")}</td>
                  <td className="py-2 pr-2"><Trend r={r} /></td>
                  <td className="py-2 pr-2 tabular">
                    {r.interval}
                    {r.keywordInterval && <span className="block text-xs text-muted-foreground">keywords every {r.keywordInterval}</span>}
                  </td>
                  <td className="py-2 pr-2" title={r.nextAt ?? undefined}>{r.next}</td>
                  <td className="py-2"><Coverage r={r} /></td>
                </tr>
                {open === r.id && (
                  <tr id={`details-${r.id}`} className="border-b bg-muted/40">
                    <td colSpan={8} className="px-3 pb-4 pt-1"><Details r={r} productId={productId} canEdit={canEdit} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-2 md:hidden" aria-label="Platform ranking">
        {ordered.map((r) => (
          <li key={r.id} className="rounded-md border">
            <button
              type="button"
              onClick={() => toggle(r.id)}
              aria-expanded={open === r.id}
              aria-controls={`card-${r.id}`}
              className="grid w-full gap-2 p-3 text-left focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="tabular text-[13px] font-medium">{r.rank !== null ? `#${r.rank}` : <Badge tone="info">New</Badge>}</span>
                  <span className="truncate font-medium">{r.name}</span>
                  {r.paid && <Badge>Paid</Badge>}
                </span>
                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open === r.id && "rotate-180")} aria-hidden />
              </span>
              <span className="grid grid-cols-3 gap-2 text-xs">
                <span className="grid"><span className="text-muted-foreground">Share</span><Score r={r} /></span>
                <span className="grid"><span className="text-muted-foreground">7 days</span><span className="tabular">{r.mentions7d}</span></span>
                <span className="grid"><span className="text-muted-foreground">Trend</span><Trend r={r} /></span>
                <span className="grid"><span className="text-muted-foreground">Every</span><span className="tabular">{r.interval}{r.keywordInterval && <span className="block text-muted-foreground">kw {r.keywordInterval}</span>}</span></span>
                <span className="grid"><span className="text-muted-foreground">Next</span><span>{r.next}</span></span>
                <span className="grid justify-items-start"><span className="text-muted-foreground">Coverage</span><Coverage r={r} /></span>
              </span>
            </button>
            {open === r.id && (
              <div id={`card-${r.id}`} className="border-t p-3"><Details r={r} productId={productId} canEdit={canEdit} /></div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
