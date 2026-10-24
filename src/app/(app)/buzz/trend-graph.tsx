"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Area, CartesianGrid, ComposedChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { FilterSelect } from "@/components/ui/filter-select";
import { RANGE_PRESETS } from "@/lib/domain/date-range";
import { cn } from "@/lib/utils";

export interface GraphPoint { start: string; value: number | null; coverage: "full" | "partial" | "none" }

interface Props {
  points: GraphPoint[];
  bucket: "hour" | "day";
  tz: string;
  events: Array<{ id: string; title: string; occurred_at: string }>;
  scope: { kind: "all" | "platform" | "keyword"; value: string | null; label: string };
  platforms: Array<{ id: string; name: string }>;
  keywords: string[];
  range: { key: string; from: string; to: string };
}

const LINE = "var(--foreground)";

type Row = { t: number; start: string; label: string; value: number | null; coverage: GraphPoint["coverage"] };

/** Mention volume over time for one scope (all activity, a platform or a keyword); unmonitored periods are gaps. */
export function TrendGraph(p: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
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
    // Start where monitoring started: a long unmonitored lead-in is noted below the graph, not drawn.
    const first = p.points.findIndex((x) => x.coverage !== "none");
    const lead = first > 0 ? first : 0;
    // Plotted at the middle of its period; shading spans the whole period.
    return p.points.slice(lead).map((x) => ({ t: new Date(x.start).getTime() + bucketMs / 2, start: x.start, label: fmt.format(new Date(x.start)), value: x.value, coverage: x.coverage }));
  }, [p.points, fmt, bucketMs]);

  const go = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) if (v === null) sp.delete(k); else sp.set(k, v);
    start(() => router.replace(`${pathname}?${sp.toString()}`, { scroll: false }));
  };
  const scopeValue = p.scope.kind === "all" ? "" : `${p.scope.kind}:${p.scope.value}`;
  const firstMonitored = p.points.findIndex((x) => x.coverage !== "none");
  const startedLate = firstMonitored > 0 ? p.points[firstMonitored]!.start : null;
  const hasData = rows.some((r) => r.value !== null);
  const domain: [number, number] = rows.length ? [rows[0]!.t - bucketMs / 2, rows.at(-1)!.t + bucketMs / 2] : [0, 1];
  const step = Math.max(1, Math.ceil(rows.length / 8));
  const ticks = rows.filter((_, i) => i % step === 0).map((r) => r.t);

  return (
    <div className="grid gap-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Graph filters">
        <FilterSelect label="Show" value={scopeValue}
          onChange={(value) => {
            const [kind, ...rest] = value.split(":");
            const v = rest.join(":");
            go(kind === "platform" ? { source: v, keyword: null } : kind === "keyword" ? { keyword: v, source: null } : { source: null, keyword: null });
          }}
          options={[
            { value: "", label: `All activity (${p.platforms.length ? "every platform" : "product"})` },
            ...p.platforms.map((x) => ({ value: `platform:${x.id}`, label: x.name, group: "Platform" })),
            ...p.keywords.map((k) => ({ value: `keyword:${k}`, label: k, group: "Keyword" })),
          ]} />
        <div role="radiogroup" aria-label="Time range" className="panel flex rounded-full p-1 text-[13px]">
          {[...RANGE_PRESETS.map((r) => ({ key: r.key, label: r.short })), { key: "custom", label: "Custom" }].map((r) => {
            const on = r.key === "custom" ? custom : p.range.key === r.key && !custom;
            return (
              <button key={r.key} type="button" role="radio" aria-checked={on}
                onClick={() => { if (r.key === "custom") setCustom(true); else { setCustom(false); go({ range: r.key, from: null, to: null }); } }}
                className={cn("press h-8 rounded-full px-3.5 transition-colors duration-200",
                  on ? "bg-foreground/[0.09] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-muted-foreground hover:text-foreground")}>
                {r.label}
              </button>
            );
          })}
        </div>
        {custom && (
          <form className="flex flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (from && to) go({ range: "custom", from, to }); }}>
            <Input type="date" aria-label="From" className="h-9 w-36 rounded-full" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" aria-label="To" className="h-9 w-36 rounded-full" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            <Button size="sm" type="submit" disabled={!from || !to}>Apply</Button>
          </form>
        )}
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating" />}
      </div>

      {!hasData ? (
        <p className="grid min-h-48 place-content-center rounded-2xl border border-dashed p-6 text-center text-[13px] text-muted-foreground" data-testid="trend-graph-empty">
          Nothing was monitored for {p.scope.label} in this period, so there is nothing to draw. Unmonitored periods are gaps, never zeros.
        </p>
      ) : (
        <div className="dots w-full min-w-0 rounded-xl" style={{ height: 320 }} data-testid="trend-graph" role="img"
          aria-label={`Mentions per ${p.bucket} for ${p.scope.label}. A data table follows.`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 12, right: 12, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="trend-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--foreground)" stopOpacity={0.16} />
                  <stop offset="100%" stopColor="var(--foreground)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 6" stroke="color-mix(in oklab, var(--foreground) 10%, transparent)" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={domain} ticks={ticks} tickFormatter={(v: number) => fmt.format(new Date(v - bucketMs / 2))}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} domain={[0, (max: number) => Math.max(3, Math.ceil(max * 1.15))]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
              {rows.filter((r) => r.coverage !== "full").map((r) => (
                <ReferenceArea key={r.start} x1={r.t - bucketMs / 2} x2={r.t + bucketMs / 2} ifOverflow="hidden"
                  fill="var(--foreground)" fillOpacity={r.coverage === "none" ? 0.07 : 0.035} strokeOpacity={0} />
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
                  return (
                    <div className="grid max-w-64 gap-1 rounded-xl border bg-surface/95 px-3 py-2 text-xs shadow-xl backdrop-blur" data-testid="trend-tooltip">
                      <p className="font-medium">{full.format(new Date(r.start))}</p>
                      {r.coverage === "none" ? <p className="text-muted-foreground">Not monitored — no data, not zero.</p> : (
                        <p className="flex justify-between gap-4"><span>Mentions</span><span className="tabular">{r.value ?? "—"}</span></p>
                      )}
                      {r.coverage === "partial" && <p className="text-muted-foreground">Only partly monitored: the count may be incomplete.</p>}
                    </div>
                  );
                }}
              />
              <Area type="monotone" dataKey="value" name="Mentions" stroke={LINE} strokeWidth={2} fill="url(#trend-area)"
                connectNulls={false} isAnimationActive={false} dot={false} activeDot={{ r: 5, fill: "var(--foreground)", stroke: "var(--surface)", strokeWidth: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground" aria-label="Legend">
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: LINE }} aria-hidden />Mentions ({p.scope.label})</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-foreground/[0.08]" aria-hidden />Not monitored</li>
        {startedLate && (
          <li className="text-muted-foreground" data-testid="graph-starts">Monitoring started {full.format(new Date(startedLate))}; the graph starts there.</li>
        )}
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-foreground/[0.04] ring-1 ring-border" aria-hidden />Partly monitored</li>
        {p.events.length > 0 && <li className="flex items-center gap-1.5"><span className="h-3 w-0 border-l-2 border-dashed border-info" aria-hidden />Your events</li>}
      </ul>

      <details className="text-[12px]">
        <summary className="cursor-pointer text-muted-foreground/80 hover:text-foreground">Show as table</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Mentions per {p.bucket} for {p.scope.label}</caption>
            <thead className="text-muted-foreground">
              <tr><th scope="col" className="py-1 pr-2 font-medium">Period</th><th scope="col" className="py-1 pr-2 text-right font-medium">Mentions</th></tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.start} className={cn(r.coverage === "none" && "text-muted-foreground")}>
                  <td className="py-1 pr-2">{r.label}</td>
                  <td className="py-1 pr-2 text-right tabular">{r.value ?? "no data"}{r.coverage === "partial" ? " (partial)" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

    </div>
  );
}

