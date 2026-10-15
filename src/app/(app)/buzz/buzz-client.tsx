"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bar, BarChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { SeriesPoint } from "@/lib/analytics/buzz";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const selectCls =
  "h-8 rounded-md border bg-background px-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

/** Remembers the viewer's time zone (cookie) so day buckets match their calendar. */
export function TimeZoneSync({ current }: { current: string }) {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== current) {
      document.cookie = `sf_tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    }
  }, [current, router]);
  return null;
}

export function PlatformFilter({ sources }: { sources: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2" aria-busy={pending}>
      <label htmlFor="buzz-source" className="text-[13px] text-muted-foreground">Platform</label>
      <select
        id="buzz-source"
        className={selectCls}
        value={params.get("source") ?? ""}
        onChange={(e) => {
          const sp = new URLSearchParams(params.toString());
          if (e.target.value) sp.set("source", e.target.value);
          else sp.delete("source");
          start(() => router.replace(`${pathname}?${sp.toString()}`, { scroll: false }));
        }}
      >
        <option value="">All platforms</option>
        {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </div>
  );
}

const COLORS = Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`);

interface ChartProps {
  points: SeriesPoint[];
  sources: Array<{ id: string; name: string }>;
  bucket: "hour" | "day";
  tz: string;
  events: Array<{ id: string; title: string; occurred_at: string }>;
  spikes: Array<{ period_start: string; platform: string | null; severity: string }>;
}

type Row = Record<string, number | string | null> & { start: string; label: string; coverage: string };

export function BuzzChart({ points, sources, bucket, tz, events, spikes }: ChartProps) {
  const [view, setView] = useState<"platform" | "relevance">("platform");
  const fmt = useMemo(() => new Intl.DateTimeFormat(undefined, bucket === "hour"
    ? { timeZone: tz, month: "short", day: "numeric", hour: "numeric" }
    : { timeZone: tz, month: "short", day: "numeric" }), [bucket, tz]);

  const rows: Row[] = points.map((p) => ({
    start: p.start,
    label: fmt.format(new Date(p.start)),
    coverage: p.coverage,
    relevant: p.relevant,
    irrelevant: p.irrelevant,
    pending: p.pending,
    gap: p.coverage === "none" ? 1 : null,
    ...Object.fromEntries(sources.map((s) => [s.id, p.bySource[s.id] ?? null])),
  }));
  const label = (iso: string) => fmt.format(new Date(iso));
  const bucketOf = (iso: string) => {
    const t = new Date(iso).getTime();
    let best: Row | null = null;
    for (const r of rows) if (new Date(r.start).getTime() <= t) best = r;
    return best?.label ?? null;
  };
  const gaps = rows.filter((r) => r.coverage === "none");
  const name = new Map(sources.map((s) => [s.id, s.name]));

  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="Chart breakdown" className="flex flex-wrap gap-1">
        {([["platform", "By platform"], ["relevance", "Relevant vs not relevant"]] as const).map(([k, l]) => (
          <Button key={k} size="sm" variant={view === k ? "default" : "secondary"} role="radio" aria-checked={view === k} onClick={() => setView(k)}>
            {l}
          </Button>
        ))}
      </div>
      <div className="h-72 w-full min-w-0" role="img" aria-label={`Mentions per ${bucket}, ${view === "platform" ? "stacked by platform" : "relevant versus not relevant"}. A data table follows.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={16} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
            {gaps.map((g) => (
              <ReferenceArea key={g.start} x1={g.label} x2={g.label} fill="var(--muted)" fillOpacity={0.7} ifOverflow="extendDomain" />
            ))}
            {events.map((e) => {
              const x = bucketOf(e.occurred_at);
              return x ? <ReferenceLine key={e.id} x={x} stroke="var(--info)" strokeDasharray="4 3" label={{ value: e.title.slice(0, 24), position: "insideTopLeft", fontSize: 10, fill: "var(--info)" }} /> : null;
            })}
            {spikes.filter((s) => !s.platform).map((s) => {
              const x = bucketOf(s.period_start);
              return x ? <ReferenceLine key={s.period_start} x={x} stroke="var(--warning)" strokeWidth={2} /> : null;
            })}
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={({ active, payload, label: l }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0]!.payload as Row;
                return (
                  <div className="grid gap-1 rounded-md border bg-surface px-2.5 py-2 text-xs shadow-sm">
                    <p className="font-medium">{l}</p>
                    {r.coverage === "none" ? (
                      <p className="text-muted-foreground">Not monitored — no data, not zero.</p>
                    ) : (
                      <>
                        {view === "platform"
                          ? sources.map((s) => (
                              <p key={s.id} className="flex justify-between gap-4">
                                <span>{s.name}</span>
                                <span className="tabular">{r[s.id] === null ? "not monitored" : r[s.id]}</span>
                              </p>
                            ))
                          : (
                            <>
                              <p className="flex justify-between gap-4"><span>Relevant</span><span className="tabular">{r.relevant}</span></p>
                              <p className="flex justify-between gap-4"><span>Not relevant</span><span className="tabular">{r.irrelevant}</span></p>
                              <p className="flex justify-between gap-4"><span>Needs review</span><span className="tabular">{r.pending}</span></p>
                            </>
                          )}
                        {r.coverage === "partial" && <p className="text-warning">Some platforms weren&apos;t fully monitored in this period.</p>}
                      </>
                    )}
                  </div>
                );
              }}
            />
            {view === "platform"
              ? sources.map((s, i) => <Bar key={s.id} dataKey={s.id} name={s.name} stackId="a" fill={COLORS[i % COLORS.length]} isAnimationActive={false} />)
              : (
                <>
                  <Bar dataKey="relevant" name="Relevant" stackId="r" fill="var(--chart-1)" isAnimationActive={false} />
                  <Bar dataKey="pending" name="Needs review" stackId="r" fill="var(--chart-5)" isAnimationActive={false} />
                  <Bar dataKey="irrelevant" name="Not relevant" stackId="r" fill="var(--chart-8)" isAnimationActive={false} />
                </>
              )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {view === "platform"
          ? sources.map((s, i) => (
              <li key={s.id} className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} aria-hidden />{s.name}</li>
            ))
          : [["var(--chart-1)", "Relevant"], ["var(--chart-5)", "Needs review"], ["var(--chart-8)", "Not relevant"]].map(([c, l]) => (
              <li key={l} className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: c }} aria-hidden />{l}</li>
            ))}
        <li className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-muted ring-1 ring-border" aria-hidden />Not monitored</li>
        {events.length > 0 && <li className="flex items-center gap-1"><span className="h-2.5 w-0 border-l-2 border-dashed border-info" aria-hidden />Your events</li>}
        {spikes.some((s) => !s.platform) && <li className="flex items-center gap-1"><span className="h-2.5 w-0 border-l-2 border-warning" aria-hidden />Spike</li>}
      </ul>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Mentions per {bucket}</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">Period</th>
                {sources.map((s) => <th key={s.id} scope="col" className="py-1 pr-2 text-right font-medium">{name.get(s.id)}</th>)}
                <th scope="col" className="py-1 text-right font-medium">Relevant total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.start} className={cn(r.coverage === "none" && "text-muted-foreground")}>
                  <td className="py-1 pr-2">{label(r.start)}</td>
                  {sources.map((s) => <td key={s.id} className="py-1 pr-2 text-right tabular">{r[s.id] ?? "—"}</td>)}
                  <td className="py-1 text-right tabular">{r.relevant ?? "no data"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
