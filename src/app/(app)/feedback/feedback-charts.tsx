"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface FeedbackDay {
  day: string;
  classified: number;
  unclassified: number;
  positive: number;
  negative: number;
  neutral: number;
  mixed: number;
  uncertain: number;
  bugs: number;
  features: number;
  complaints: number;
}

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const label = (day: string) => day.slice(5);

function Legend({ items }: { items: Array<{ color?: string; dashed?: boolean; text: string }> }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {items.map((i) => (
        <li key={i.text} className="flex items-center gap-1">
          {i.dashed
            ? <span className="size-2.5 rounded-sm border border-dashed border-muted-foreground" aria-hidden />
            : <span className="size-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />}
          {i.text}
        </li>
      ))}
    </ul>
  );
}

function TableView({ caption, head, rows }: { caption: string; head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
      <div className="mt-2 max-h-72 overflow-auto">
        <table className="w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="text-muted-foreground">
            <tr>{head.map((h, i) => <th key={h} scope="col" className={i ? "py-1 pr-2 text-right font-medium" : "py-1 pr-2 font-medium"}>{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={String(r[0])}>{r.map((c, i) => <td key={i} className={i ? "py-1 pr-2 text-right tabular" : "py-1 pr-2"}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function TooltipBox({ title, lines }: { title: string; lines: Array<[string, number | string]> }) {
  return (
    <div className="grid gap-1 rounded-md border bg-surface px-2.5 py-2 text-xs shadow-sm">
      <p className="font-medium">{title}</p>
      {lines.map(([k, v]) => <p key={k} className="flex justify-between gap-4"><span>{k}</span><span className="tabular">{v}</span></p>)}
    </div>
  );
}

/**
 * Sentiment toward the product per day. Diverging encoding (negative red ↔ positive blue,
 * gray midpoint for neutral, mixed or unclear). Mentions not yet classified are an
 * outlined segment, never folded into a sentiment.
 */
export function SentimentChart({ days }: { days: FeedbackDay[] }) {
  const rows = days.map((d) => ({ ...d, label: label(d.day), middle: d.neutral + d.mixed + d.uncertain }));
  return (
    <div className="grid gap-3">
      <div className="h-60 w-full min-w-0" role="img" aria-label="Sentiment toward the product per day, with unclassified mentions shown separately. A data table follows.">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={16} />
            <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]!.payload as (typeof rows)[number];
              return <TooltipBox title={r.day} lines={[["Negative", r.negative], ["Neutral", r.neutral], ["Mixed", r.mixed], ["Unclear", r.uncertain], ["Positive", r.positive], ["Not yet classified", r.unclassified]]} />;
            }} />
            <Bar dataKey="negative" stackId="s" fill="var(--sentiment-negative)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false} />
            <Bar dataKey="middle" stackId="s" fill="var(--sentiment-neutral)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false} />
            <Bar dataKey="positive" stackId="s" fill="var(--sentiment-positive)" stroke="var(--surface)" strokeWidth={1} isAnimationActive={false} />
            <Bar dataKey="unclassified" stackId="s" fill="transparent" stroke="var(--muted-foreground)" strokeDasharray="3 2" isAnimationActive={false} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[
        { color: "var(--sentiment-negative)", text: "Negative" },
        { color: "var(--sentiment-neutral)", text: "Neutral, mixed or unclear" },
        { color: "var(--sentiment-positive)", text: "Positive" },
        { dashed: true, text: "Not yet classified" },
      ]} />
      <TableView caption="Sentiment per day" head={["Day", "Negative", "Neutral", "Mixed", "Unclear", "Positive", "Not classified"]}
        rows={days.map((d) => [d.day, d.negative, d.neutral, d.mixed, d.uncertain, d.positive, d.unclassified])} />
    </div>
  );
}

const SERIES = [
  { key: "bugs", name: "Bug reports", color: "var(--feedback-bug)" },
  { key: "features", name: "Feature requests", color: "var(--feedback-feature)" },
  { key: "complaints", name: "Complaints", color: "var(--feedback-complaint)" },
] as const;

/** Bug reports, feature requests and complaints per day (classified mentions only). */
export function FeedbackTrendChart({ days }: { days: FeedbackDay[] }) {
  const rows = days.map((d) => ({ ...d, label: label(d.day) }));
  return (
    <div className="grid gap-3">
      <div className="h-60 w-full min-w-0" role="img" aria-label="Bug reports, feature requests and complaints per day. A data table follows.">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={16} />
            <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ stroke: "var(--border)" }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]!.payload as (typeof rows)[number];
              return <TooltipBox title={r.day} lines={[...SERIES.map((s) => [s.name, r[s.key]] as [string, number]), ["Not yet classified", r.unclassified]]} />;
            }} />
            {SERIES.map((s) => (
              // Straight segments with a marker per day: daily counts have no values between days, and a
              // smoothed curve would draw some (dipping below zero or overshooting).
              <Line key={s.key} type="linear" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2}
                dot={{ r: 3, fill: s.color, stroke: "var(--surface)", strokeWidth: 2 }}
                activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legend items={SERIES.map((s) => ({ color: s.color, text: s.name }))} />
      <TableView caption="Feedback per day" head={["Day", ...SERIES.map((s) => s.name), "Not classified"]}
        rows={days.map((d) => [d.day, d.bugs, d.features, d.complaints, d.unclassified])} />
    </div>
  );
}
