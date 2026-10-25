"use client";

import { Fragment, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, Minus, Sparkle } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import type { SkippedKeyword } from "@/lib/sources/query-optimizer";
import { setSourceEnabledAction } from "@/app/actions/monitoring";
import { FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { cn } from "@/lib/utils";

export function SourceToggle({ productId, platform, name, enabled, disabledReason }: {
  productId: string; platform: string; name: string; enabled: boolean; paid: boolean; disabledReason?: string;
}) {
  const [state, action] = useFormAction(setSourceEnabledAction, idle);
  return (
    <form action={action} className="grid gap-1.5">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="platform" value={platform} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <SubmitButton
        size="sm"
        variant={enabled ? "secondary" : "ghost"}
        disabled={Boolean(disabledReason)}
        aria-label={`${enabled ? "Turn off" : "Turn on"} ${name}`}
        pendingLabel="Saving…"
      >
        {enabled ? "Turn off" : "Turn on"}
      </SubmitButton>
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
          <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${Math.min(100, r.sharePct)}%` }} />
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

/** One signal as a diverging bar: what pushed this platform up (ink) or down (red); the detail is in the tooltip. */
function SignalBars({ r }: { r: RankingRow }) {
  const max = Math.max(1, ...r.components.filter((c) => c.measured).map((c) => Math.abs(c.points)));
  return (
    <ul className="grid gap-1.5" aria-label={`${r.name} measured signals`}>
      {r.components.map((c) => {
        const w = c.measured ? (Math.abs(c.points) / max) * 50 : 0;
        return (
          <li key={c.id} className="grid grid-cols-[9.5rem_minmax(0,1fr)_3.25rem] items-center gap-3 text-[12px]" title={c.detail}>
            <span className={cn("truncate", !c.measured && "text-muted-foreground/70")}>{c.label}<span className="sr-only"> · {c.detail}</span></span>
            <span className="relative h-2.5 rounded-full bg-foreground/[0.05]" aria-hidden>
              <span className="absolute inset-y-[-2px] left-1/2 w-px bg-foreground/20" />
              {c.measured && c.points !== 0 && (
                <span className={cn("absolute inset-y-0 rounded-full", c.points > 0 ? "bg-foreground/70" : "bg-signal")}
                  style={c.points > 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
              )}
            </span>
            <span className={cn("text-right tabular-nums", c.measured ? (c.points < 0 ? "text-signal" : "") : "text-muted-foreground/70")}>
              {c.measured ? (c.points < 0 ? `−${Math.abs(c.points)}` : `+${c.points}`) : "not measured"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MiniRing({ value }: { value: number }) {
  const c = 2 * Math.PI * 16;
  return (
    <svg viewBox="0 0 40 40" className="size-10 shrink-0 -rotate-90" aria-hidden>
      <circle cx="20" cy="20" r="16" fill="none" stroke="color-mix(in oklab, var(--foreground) 8%, transparent)" strokeWidth="5" />
      {value > 0 && <circle cx="20" cy="20" r="16" fill="none" stroke={value < 50 ? "var(--signal)" : "var(--foreground)"} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} />}
    </svg>
  );
}

function Details({ r, productId, canEdit }: { r: RankingRow; productId: string; canEdit: boolean }) {
  const kw = r.keywords;
  return (
    <div className="grid gap-5 text-[13px] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <section className="grid gap-2">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">Why this rank</h4>
          <p>{r.rankText}</p>
          {r.components.length > 0 && <SignalBars r={r} />}
        </section>
        <section className="grid gap-1.5">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">Why this interval</h4>
          {r.intervalText && <p>{r.intervalText}</p>}
          {r.keywordInterval && <p className="text-[12px] text-muted-foreground">Each keyword is searched every {r.keywordInterval} (keywords take turns).</p>}
          {r.keywordConflict && <p className="text-[12px] text-warning">{r.keywordConflict}</p>}
          {(r.reasons.length > 0 || r.planNote) && (
            <details className="text-[12px] text-muted-foreground">
              <summary className="w-fit cursor-pointer hover:text-foreground">Why exactly</summary>
              <ul className="mt-1.5 grid gap-1 pl-4 [list-style:disc]">
                {r.reasons.map((x) => <li key={x}>{x}</li>)}
                {r.planNote && <li>{r.planNote}</li>}
              </ul>
            </details>
          )}
        </section>
      </div>
      <div className="grid content-start gap-4">
        <section className="grid gap-2.5">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">Coverage</h4>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={r.stateTone}>{r.stateLabel}</Badge>
            {r.paid && <Badge>Paid</Badge>}
            {r.saturated && <Badge tone="warning">Hit page limit recently</Badge>}
            {r.risk && r.risk !== "none" && <Badge tone={r.risk === "watch" ? "info" : "warning"} title={r.riskDetail ?? undefined}>{RISK_LABEL[r.risk]}</Badge>}
            {r.failures > 0 && <Badge tone="negative">{r.failures} failed check{r.failures === 1 ? "" : "s"}</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            <div className="flex items-center gap-2.5 rounded-xl bg-foreground/[0.03] p-2.5">
              {r.completeSharePct !== null && <MiniRing value={r.completeSharePct} />}
              <span className="grid">
                <span className="text-[15px] font-semibold tabular-nums">{r.completeSharePct !== null ? `${r.completeSharePct}%` : "—"}</span>
                <span className="text-[11px] text-muted-foreground">covered, 7 days</span>
              </span>
            </div>
            <div className="grid rounded-xl bg-foreground/[0.03] p-2.5" title={r.lastAt ?? undefined}>
              <span className="text-[15px] font-semibold">{r.last}</span><span className="text-[11px] text-muted-foreground">Last checked</span>
            </div>
            <div className="grid rounded-xl bg-foreground/[0.03] p-2.5" title={r.nextAt ?? undefined}>
              <span className="text-[15px] font-semibold">{r.next}</span><span className="text-[11px] text-muted-foreground">Next check</span>
            </div>
            <div className="grid rounded-xl bg-foreground/[0.03] p-2.5" title={r.discovery ?? undefined}>
              <span className="text-[15px] font-semibold">{r.arrivalPerDay !== null && !r.learning ? `~${r.arrivalPerDay >= 10 ? Math.round(r.arrivalPerDay) : r.arrivalPerDay}/day` : "—"}</span>
              <span className="text-[11px] text-muted-foreground">Relevant mentions</span>
            </div>
          </div>
          {r.arrivalPerDay !== null && !r.learning && (
            <p className="sr-only">About {r.arrivalPerDay >= 10 ? Math.round(r.arrivalPerDay) : r.arrivalPerDay} relevant mention{r.arrivalPerDay === 1 ? "" : "s"} a day here (estimated from recent checks).</p>
          )}
          {r.riskDetail && <p className="text-[12px] text-warning">{r.riskDetail}</p>}
          {r.incomplete && <p className="text-[12px] text-warning">Coverage is incomplete, so a low count here doesn&apos;t prove the platform is quiet.</p>}
          {r.stateDetail && <p className="text-[12px] text-muted-foreground">{r.stateDetail}</p>}
          {r.discovery && <p className="sr-only">Expected discovery: {r.discovery}</p>}
        </section>
        <section className="grid gap-1.5">
          <h4 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">Keywords on {r.name}</h4>
          {kw.productOnly ? (
            <p className="text-[12px]">Collects reviews of your product&apos;s own page; keywords aren&apos;t used.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                {kw.searched.length > 0
                  ? <>Searched: {kw.searched.map((t) => <span key={t} className="rounded-full bg-foreground/[0.06] px-2 py-0.5">{t}</span>)}</>
                  : "No keywords searched"}
                <span className="text-muted-foreground">
                  · {kw.searches} search{kw.searches === 1 ? "" : "es"}{kw.combined ? " (combined)" : ""}{kw.rotating > 0 ? ` · ${kw.rotating} take turns` : ""}
                </span>
              </div>
              {kw.skipped.map((x) => <p key={x.term} className="text-[12px] text-muted-foreground">“{x.term}”: {x.detail}</p>)}
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
                <tr className={cn("border-b border-foreground/[0.06] align-middle transition-colors hover:bg-foreground/[0.025]", open === r.id && "border-b-0 bg-foreground/[0.03]")}>
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
                  <tr id={`details-${r.id}`} className="border-b border-foreground/[0.06] bg-foreground/[0.03]">
                    <td colSpan={8} className="px-4 pb-5 pt-2"><Details r={r} productId={productId} canEdit={canEdit} /></td>
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
