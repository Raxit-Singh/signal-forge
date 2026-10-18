"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Area, CartesianGrid, ComposedChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from "recharts";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Input } from "@/components/ui/primitives";
import { Dialog, SidePanelContent } from "@/components/ui/overlays";
import { ActionForm } from "@/components/ai/action-form";
import { InvestigationResult, type InvestigationView } from "@/components/ai/investigation-result";
import { explainSpikeAction } from "@/app/actions/ai";
import { spikeDetailsAction, type SpikeDetails } from "@/app/actions/buzz";
import { RANGE_PRESETS } from "@/lib/domain/date-range";
import { cn } from "@/lib/utils";

export interface GraphPoint { start: string; value: number | null; coverage: "full" | "partial" | "none" }

export interface GraphSpike {
  id: string;
  start: string;
  end: string;
  granularity: "hour" | "day";
  observed: number;
  expected: number;
  ratio: number | null;
  confidence: "confirmed" | "possible";
  severity: string;
  note: string | null;
  platform: string | null;
  keyword: string | null;
  scopeLabel: string;
  explanation: InvestigationView | null;
}

interface Props {
  points: GraphPoint[];
  bucket: "hour" | "day";
  tz: string;
  spikes: GraphSpike[];
  events: Array<{ id: string; title: string; occurred_at: string }>;
  scope: { kind: "all" | "platform" | "keyword"; value: string | null; label: string };
  platforms: Array<{ id: string; name: string }>;
  keywords: string[];
  range: { key: string; from: string; to: string };
  insufficient: { baseline: number; needed: number } | null;
  canExplain: boolean;
  workspaceId: string;
  productId: string;
}

const LINE = "var(--entity-1)";
const CONFIRMED = "var(--negative)";
const POSSIBLE = "var(--warning)";
const selectCls = "h-8 rounded-md border bg-background px-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

type Row = { t: number; start: string; label: string; value: number | null; coverage: GraphPoint["coverage"]; confirmed: number | null; possible: number | null; spike: GraphSpike | null };

const fmtNum = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString("en-US"));
const multiple = (s: GraphSpike) => {
  const r = s.ratio ?? (s.expected > 0 ? s.observed / s.expected : null);
  return r === null ? "well above usual (no usual activity yet)" : `${r >= 10 ? Math.round(r) : r.toFixed(1)}× usual`;
};
const strength = (s: GraphSpike) => (s.confidence === "confirmed" ? 2 : 1) * 1000 + (s.ratio ?? 0);

/** Mention volume over time for one scope, with detected spikes marked on the same graph. */
export function SpikeGraph(p: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [custom, setCustom] = useState(p.range.key === "custom");
  const [from, setFrom] = useState(p.range.key === "custom" ? p.range.from : "");
  const [to, setTo] = useState(p.range.key === "custom" ? p.range.to : "");

  const fmt = useMemo(() => new Intl.DateTimeFormat("en-US", p.bucket === "hour"
    ? { timeZone: p.tz, month: "short", day: "numeric", hour: "numeric" }
    : { timeZone: p.tz, month: "short", day: "numeric" }), [p.bucket, p.tz]);
  const full = useMemo(() => new Intl.DateTimeFormat("en-US", p.bucket === "hour"
    ? { timeZone: p.tz, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
    : { timeZone: p.tz, weekday: "short", month: "short", day: "numeric", year: "numeric" }), [p.bucket, p.tz]);

  const bucketMs = p.bucket === "hour" ? 3_600_000 : 86_400_000;
  const rows: Row[] = useMemo(() => {
    const starts = p.points.map((x) => new Date(x.start).getTime());
    const bucketOf = (iso: string) => {
      const t = new Date(iso).getTime();
      let idx = -1;
      for (let i = 0; i < starts.length; i++) if (starts[i]! <= t) idx = i;
      return idx;
    };
    // One marker per period: the strongest spike in it (confirmed before possible).
    const byBucket = new Map<number, GraphSpike>();
    for (const s of p.spikes) {
      const i = bucketOf(s.start);
      if (i < 0) continue;
      const cur = byBucket.get(i);
      if (!cur || strength(s) > strength(cur)) byBucket.set(i, s);
    }
    return p.points.map((x, i) => {
      const s = byBucket.get(i) ?? null;
      const y = s ? (x.value ?? s.observed) : null;
      return {
        // Plotted at the middle of its period; shading spans the whole period.
        t: new Date(x.start).getTime() + bucketMs / 2, start: x.start, label: fmt.format(new Date(x.start)), value: x.value, coverage: x.coverage, spike: s,
        confirmed: s?.confidence === "confirmed" ? y : null, possible: s?.confidence === "possible" ? y : null,
      };
    });
  }, [p.points, p.spikes, fmt, bucketMs]);

  const selected = p.spikes.find((s) => s.id === selectedId) ?? null;
  const go = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) if (v === null) sp.delete(k); else sp.set(k, v);
    start(() => router.replace(`${pathname}?${sp.toString()}`, { scroll: false }));
  };
  const scopeValue = p.scope.kind === "all" ? "" : `${p.scope.kind}:${p.scope.value}`;
  const marked = rows.filter((r) => r.spike);
  const hasData = rows.some((r) => r.value !== null);
  const domain: [number, number] = rows.length ? [rows[0]!.t - bucketMs / 2, rows.at(-1)!.t + bucketMs / 2] : [0, 1];
  const step = Math.max(1, Math.ceil(rows.length / 8));
  const ticks = rows.filter((_, i) => i % step === 0).map((r) => r.t);

  return (
    <div className="grid gap-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Graph filters">
        <label htmlFor="spike-scope" className="text-[13px] text-muted-foreground">Show</label>
        <select
          id="spike-scope" className={selectCls} value={scopeValue}
          onChange={(e) => {
            const [kind, ...rest] = e.target.value.split(":");
            const v = rest.join(":");
            go(kind === "platform" ? { source: v, keyword: null } : kind === "keyword" ? { keyword: v, source: null } : { source: null, keyword: null });
          }}
        >
          <option value="">All activity ({p.platforms.length ? "every platform" : "product"})</option>
          {p.platforms.length > 0 && (
            <optgroup label="Platform">
              {p.platforms.map((x) => <option key={x.id} value={`platform:${x.id}`}>{x.name}</option>)}
            </optgroup>
          )}
          {p.keywords.length > 0 && (
            <optgroup label="Keyword">
              {p.keywords.map((k) => <option key={k} value={`keyword:${k}`}>{k}</option>)}
            </optgroup>
          )}
        </select>
        <div role="radiogroup" aria-label="Time range" className="flex flex-wrap gap-1">
          {RANGE_PRESETS.map((r) => (
            <Button key={r.key} size="sm" role="radio" aria-checked={p.range.key === r.key && !custom} variant={p.range.key === r.key && !custom ? "default" : "secondary"}
              onClick={() => { setCustom(false); go({ range: r.key, from: null, to: null }); }}>
              {r.short}
            </Button>
          ))}
          <Button size="sm" role="radio" aria-checked={custom} variant={custom ? "default" : "secondary"} onClick={() => setCustom(true)}>Custom</Button>
        </div>
        {custom && (
          <form className="flex flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (from && to) go({ range: "custom", from, to }); }}>
            <Input type="date" aria-label="From" className="h-8 w-36" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" aria-label="To" className="h-8 w-36" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            <Button size="sm" type="submit" disabled={!from || !to}>Apply</Button>
          </form>
        )}
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating" />}
      </div>

      {!hasData ? (
        <p className="rounded-md border p-6 text-center text-[13px] text-muted-foreground" data-testid="spike-graph-empty">
          Nothing was monitored for {p.scope.label} in this period, so there is nothing to draw. Unmonitored periods are gaps, never zeros.
        </p>
      ) : (
        <div className="h-72 w-full min-w-0" data-testid="spike-graph" role="img"
          aria-label={`Mentions per ${p.bucket} for ${p.scope.label}, ${marked.length} spike${marked.length === 1 ? "" : "s"} marked. A data table follows.`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 12, right: 12, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={domain} ticks={ticks} tickFormatter={(v: number) => fmt.format(new Date(v - bucketMs / 2))}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
              <YAxis allowDecimals={false} domain={[0, (max: number) => Math.max(3, Math.ceil(max * 1.15))]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
              {rows.filter((r) => r.coverage !== "full").map((r) => (
                <ReferenceArea key={r.start} x1={r.t - bucketMs / 2} x2={r.t + bucketMs / 2} ifOverflow="hidden"
                  fill="var(--muted-foreground)" fillOpacity={r.coverage === "none" ? 0.16 : 0.07} strokeOpacity={0} />
              ))}
              {p.events.map((e) => {
                const at = new Date(e.occurred_at).getTime();
                return at >= domain[0] && at <= domain[1] ? <ReferenceLine key={e.id} x={at} stroke="var(--info)" strokeDasharray="4 3" label={{ value: e.title.slice(0, 24), position: "insideTopLeft", fontSize: 10, fill: "var(--muted-foreground)" }} /> : null;
              })}
              <Tooltip
                cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const r = payload[0]!.payload as Row;
                  const s = r.spike;
                  return (
                    <div className="grid max-w-64 gap-1 rounded-md border bg-surface px-2.5 py-2 text-xs shadow-sm" data-testid="spike-tooltip">
                      <p className="font-medium">{full.format(new Date(r.start))}</p>
                      {r.coverage === "none" ? <p className="text-muted-foreground">Not monitored — no data, not zero.</p> : (
                        <p className="flex justify-between gap-4"><span>Mentions</span><span className="tabular">{r.value ?? "—"}</span></p>
                      )}
                      {r.coverage === "partial" && <p className="text-muted-foreground">Only partly monitored: the count may be incomplete.</p>}
                      {s && (
                        <div className="mt-1 grid gap-0.5 border-t pt-1">
                          <p className="font-medium">{s.confidence === "confirmed" ? "Confirmed spike" : "Possible spike"} · {s.scopeLabel}</p>
                          <p className="flex justify-between gap-4"><span>Spike period</span><span className="tabular">{s.observed}</span></p>
                          <p className="flex justify-between gap-4"><span>Usual</span><span className="tabular">~{fmtNum(Number(s.expected))}</span></p>
                          <p>{multiple(s)}</p>
                          <p className="text-muted-foreground">Click the marker for details.</p>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Area type="monotone" dataKey="value" name="Mentions" stroke={LINE} strokeWidth={2} fill={LINE} fillOpacity={0.1}
                connectNulls={false} isAnimationActive={false} dot={false} activeDot={{ r: 4 }} />
              <Scatter dataKey="confirmed" name="Confirmed spike" fill={CONFIRMED} isAnimationActive={false}
                shape={(props: unknown) => <Marker {...(props as MarkerProps)} kind="confirmed" onSelect={setSelectedId} />} />
              <Scatter dataKey="possible" name="Possible spike" fill={POSSIBLE} isAnimationActive={false}
                shape={(props: unknown) => <Marker {...(props as MarkerProps)} kind="possible" onSelect={setSelectedId} />} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: LINE }} aria-hidden />Mentions ({p.scope.label})</li>
        <li className="flex items-center gap-1.5"><svg width="12" height="12" aria-hidden><path d="M6 1 L11 11 L1 11 Z" fill={CONFIRMED} /></svg>Confirmed spike</li>
        <li className="flex items-center gap-1.5"><svg width="12" height="12" aria-hidden><circle cx="6" cy="6" r="4.5" fill="var(--surface)" stroke={POSSIBLE} strokeWidth="2" /></svg>Possible spike</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-muted-foreground/15" aria-hidden />Not monitored</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-muted-foreground/[0.07] ring-1 ring-border" aria-hidden />Partly monitored</li>
        {p.events.length > 0 && <li className="flex items-center gap-1.5"><span className="h-3 w-0 border-l-2 border-dashed border-info" aria-hidden />Your events</li>}
      </ul>

      {p.insufficient && (
        <p className="text-xs text-muted-foreground" data-testid="spike-insufficient">
          Spike confidence is still developing: {p.insufficient.baseline} of {p.insufficient.needed} completely monitored {p.bucket === "hour" ? "hours" : "days"} needed for a baseline.
        </p>
      )}

      {marked.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Spikes in this period" role="list">
          <span className="text-muted-foreground">Spikes:</span>
          {marked.map((r) => (
            <button key={r.spike!.id} type="button" role="listitem" onClick={() => setSelectedId(r.spike!.id)}
              className="rounded-full border px-2 py-0.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              {r.label} · {r.spike!.confidence === "confirmed" ? "confirmed" : "possible"}
            </button>
          ))}
        </div>
      )}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Mentions per {p.bucket} for {p.scope.label}</caption>
            <thead className="text-muted-foreground">
              <tr><th scope="col" className="py-1 pr-2 font-medium">Period</th><th scope="col" className="py-1 pr-2 text-right font-medium">Mentions</th><th scope="col" className="py-1 font-medium">Spike</th></tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.start} className={cn(r.coverage === "none" && "text-muted-foreground")}>
                  <td className="py-1 pr-2">{r.label}</td>
                  <td className="py-1 pr-2 text-right tabular">{r.value ?? "no data"}{r.coverage === "partial" ? " (partial)" : ""}</td>
                  <td className="py-1">{r.spike ? `${r.spike.confidence === "confirmed" ? "Confirmed" : "Possible"}: ${r.spike.observed} vs ~${fmtNum(Number(r.spike.expected))} usual` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <Dialog open={selected !== null} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
        {selected && (
          <SidePanelContent title={`${selected.confidence === "confirmed" ? "Confirmed" : "Possible"} spike`} description={`${full.format(new Date(selected.start))} · ${selected.scopeLabel}`}>
            <SpikePanel spike={selected} platforms={p.platforms} canExplain={p.canExplain} workspaceId={p.workspaceId} productId={p.productId} />
          </SidePanelContent>
        )}
      </Dialog>
    </div>
  );
}

interface MarkerProps { cx?: number; cy?: number; payload?: Row }

/** Spike marker with a hit target larger than the mark; keyboard reachable. */
function Marker({ cx, cy, payload, kind, onSelect }: MarkerProps & { kind: "confirmed" | "possible"; onSelect: (id: string) => void }) {
  // Each marker series only draws its own kind (the other series' rows have no value here).
  if (cx === undefined || cy === undefined || !payload?.spike || payload.spike.confidence !== kind) return null;
  const s = payload.spike;
  const open = () => onSelect(s.id);
  return (
    <g role="button" tabIndex={0} aria-label={`${kind === "confirmed" ? "Confirmed" : "Possible"} spike, ${payload.label}: ${s.observed} mentions vs about ${fmtNum(Number(s.expected))} usual`}
      data-testid={`spike-marker-${kind}`} style={{ cursor: "pointer" }} onClick={open}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}>
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      {kind === "confirmed"
        ? <path d={`M${cx} ${cy - 7} L${cx + 7} ${cy + 5} L${cx - 7} ${cy + 5} Z`} fill={CONFIRMED} stroke="var(--surface)" strokeWidth={2} />
        : <circle cx={cx} cy={cy} r={5.5} fill="var(--surface)" stroke={POSSIBLE} strokeWidth={2.5} />}
    </g>
  );
}

function SpikePanel({ spike, platforms, canExplain, workspaceId, productId }: {
  spike: GraphSpike; platforms: Array<{ id: string; name: string }>; canExplain: boolean; workspaceId: string; productId: string;
}) {
  const [details, setDetails] = useState<SpikeDetails | null>(null);
  useEffect(() => {
    let live = true;
    spikeDetailsAction({ productId, start: new Date(spike.start).toISOString(), end: new Date(spike.end).toISOString(), platform: spike.platform, keyword: spike.keyword })
      .then((d) => { if (live) setDetails(d); });
    return () => { live = false; };
  }, [productId, spike.start, spike.end, spike.platform, spike.keyword]);
  const name = (id: string) => platforms.find((x) => x.id === id)?.name ?? id;
  const inv = spike.explanation;

  return (
    <div className="grid gap-5 text-[13px]" data-testid="spike-panel">
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="text-xs text-muted-foreground">Mentions</dt><dd className="text-xl font-semibold tabular">{spike.observed}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Usual for this {spike.granularity}</dt><dd className="text-xl font-semibold tabular">~{fmtNum(Number(spike.expected))}</dd></div>
        <div className="col-span-2"><dt className="sr-only">Compared with usual</dt><dd>{multiple(spike)}</dd></div>
        <div className="col-span-2 flex flex-wrap gap-1.5">
          <Badge tone={spike.confidence === "confirmed" ? "negative" : "warning"}>{spike.confidence === "confirmed" ? "Confirmed" : "Possible"}</Badge>
          {spike.confidence === "confirmed" && <Badge>{spike.severity === "major" ? "Major" : "Notable"}</Badge>}
        </div>
        {spike.note && <p className="col-span-2 text-xs text-muted-foreground">{spike.note}</p>}
        {spike.confidence === "possible" && !spike.note && <p className="col-span-2 text-xs text-muted-foreground">Unusual, but the evidence isn&apos;t strong enough to confirm (short baseline or incomplete monitoring).</p>}
      </dl>

      <section className="grid gap-2" aria-label="Contributing platforms and keywords">
        {!details ? <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden />Loading what made up this spike…</p> : !details.ok ? (
          <p className="text-xs text-muted-foreground">Details couldn&apos;t be loaded.</p>
        ) : (
          <>
            <div className="grid gap-1">
              <h3 className="text-xs font-medium">Contributing platforms</h3>
              {details.platforms.length === 0 ? <p className="text-xs text-muted-foreground">No relevant mentions stored for this period.</p> : (
                <ul className="grid gap-0.5 text-xs" aria-label="Contributing platforms">
                  {details.platforms.map((x) => <li key={x.id} className="flex justify-between"><span>{name(x.id)}</span><span className="tabular">{x.mentions}</span></li>)}
                </ul>
              )}
            </div>
            <div className="grid gap-1">
              <h3 className="text-xs font-medium">Contributing keywords</h3>
              {details.keywords.length === 0 ? <p className="text-xs text-muted-foreground">No keyword matches recorded.</p> : (
                <ul className="grid gap-0.5 text-xs" aria-label="Contributing keywords">
                  {details.keywords.map((x) => <li key={x.keyword} className="flex justify-between"><span>{x.keyword}</span><span className="tabular">{x.mentions}</span></li>)}
                </ul>
              )}
            </div>
            <div className="grid gap-1">
              <h3 className="text-xs font-medium">Relevant mentions</h3>
              {details.mentions.length === 0 ? <p className="text-xs text-muted-foreground">None stored.</p> : (
                <ul className="grid gap-1.5 text-xs" aria-label="Relevant mentions">
                  {details.mentions.map((m) => (
                    <li key={m.id} className="grid gap-0.5 rounded border p-2">
                      <a href={m.url} target="_blank" rel="noreferrer noopener" className="line-clamp-2 underline-offset-2 hover:underline">{m.title} <ExternalLink className="inline size-3" aria-hidden /></a>
                      <span className="text-muted-foreground">{name(m.source)} · {new Date(m.publishedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      <section className="grid gap-2 border-t pt-4" aria-label="AI explanation">
        <h3 className="text-xs font-medium">AI explanation</h3>
        {inv && <InvestigationResult inv={inv} />}
        {!inv && <p className="text-xs text-muted-foreground">Not explained yet. Explanations are only made when you ask, and cite the stored posts they rely on.</p>}
        {canExplain && (!inv || inv.status === "failed") && (
          <ActionForm action={explainSpikeAction} label={inv ? "Try again" : "Explain with AI"} pendingLabel="Requesting…"
            fields={{ workspaceId, productId, granularity: spike.granularity, platform: spike.keyword ? "" : spike.platform ?? "", keyword: spike.keyword ?? "", periodStart: new Date(spike.start).toISOString(), force: inv ? "true" : "false" }} />
        )}
      </section>
    </div>
  );
}
