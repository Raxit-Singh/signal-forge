"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

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

// Obsidian charts: one signal red for what needs attention (bugs, negative sentiment); everything
// else is foreground ink at a few strengths, so the charts read in dark and light alike.
const ink = (a: number) => `color-mix(in oklab, var(--foreground) ${Math.round(a * 100)}%, transparent)`;
const vars = (v: Record<string, string | number | undefined>) => v as React.CSSProperties;
const short = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const long = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function Legend({ items }: { items: Array<{ color: string; text: string; glow?: boolean }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground" aria-label="Legend">
      {items.map((i) => (
        <li key={i.text} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: i.color, boxShadow: i.glow ? "var(--signal-glow)" : undefined }} aria-hidden />
          {i.text}
        </li>
      ))}
    </ul>
  );
}

function TableView({ caption, head, rows }: { caption: string; head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <details className="text-[12px]">
      <summary className="cursor-pointer text-muted-foreground/80 hover:text-foreground">Show as table</summary>
      <div className="mt-2 max-h-72 overflow-auto">
        <table className="w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="text-muted-foreground">
            <tr>{head.map((h, i) => <th key={h} scope="col" className={i ? "py-1 pr-2 text-right font-medium" : "py-1 pr-2 font-medium"}>{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-foreground/[0.06]">
            {rows.map((r) => (
              <tr key={String(r[0])}>{r.map((c, i) => <td key={i} className={i ? "py-1 pr-2 text-right tabular" : "py-1 pr-2"}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Tip({ show, side, title, lines }: { show: boolean; side: "left" | "right"; title: string; lines: Array<[string, number, string?]> }) {
  return (
    <span className={cn("pointer-events-none absolute bottom-full z-10 mb-2 w-max rounded-lg border bg-surface/95 px-2.5 py-1.5 text-[11px] shadow-xl transition-opacity duration-150",
      side === "left" ? "left-0" : "right-0", show ? "visible opacity-100" : "invisible opacity-0")}>
      <span className="block text-muted-foreground">{title}</span>
      {lines.map(([k, v, color]) => (
        <span key={k} className="flex items-center gap-1.5 tabular-nums">
          {color && <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden />}{v.toLocaleString("en-US")} {k}
        </span>
      ))}
    </span>
  );
}

const SERIES = [
  { key: "bugs", name: "Bug reports", color: "var(--signal)" },
  { key: "complaints", name: "Complaints", color: ink(0.62) },
  { key: "features", name: "Feature requests", color: ink(0.28) },
] as const;

/** Bug reports, complaints and feature requests per day as stacked capsules (bugs in red at the base). */
export function FeedbackTrendChart({ days, height = 170 }: { days: FeedbackDay[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = (d: FeedbackDay) => d.bugs + d.features + d.complaints;
  const max = Math.max(1, ...days.map(total));
  return (
    <div className="grid gap-2.5 overflow-x-clip">
      <div className="flex items-end gap-[3px] sm:gap-1" style={{ height }} onMouseLeave={() => setHover(null)}
        role="img" aria-label="Bug reports, feature requests and complaints per day. A data table follows.">
        {days.map((d, i) => {
          const t = total(d);
          return (
            <div key={d.day} className="relative flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHover(i)}>
              <span className="grow-y flex w-full flex-col-reverse overflow-hidden rounded-full bg-foreground/[0.05]"
                style={vars({ height: `${Math.max(3, (t / max) * 100)}%`, "--d": `${300 + i * 18}ms`, opacity: hover === null || hover === i ? 1 : 0.5, transition: "opacity 150ms ease" })}>
                {SERIES.map((s) => d[s.key] > 0 && (
                  <span key={s.key} className="block w-full" style={{ height: `${(d[s.key] / Math.max(1, t)) * 100}%`, background: s.color,
                    boxShadow: s.key === "bugs" ? "0 0 14px color-mix(in oklab, var(--signal) 50%, transparent)" : undefined }} />
                ))}
              </span>
              <Tip show={hover === i} side={i < days.length / 2 ? "left" : "right"} title={long(d.day)}
                lines={[...SERIES.map((s) => [s.name.toLowerCase(), d[s.key], s.color] as [string, number, string]), ["not yet classified", d.unclassified]]} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[12px] text-muted-foreground/80"><span>{days[0] && short(days[0].day)}</span><span>{days.at(-1) && short(days.at(-1)!.day)}</span></div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend items={SERIES.map((s) => ({ color: s.color, text: s.name, glow: s.key === "bugs" }))} />
        <TableView caption="Feedback per day" head={["Day", ...SERIES.map((s) => s.name), "Not classified"]}
          rows={days.map((d) => [d.day, d.bugs, d.complaints, d.features, d.unclassified])} />
      </div>
    </div>
  );
}

/**
 * Sentiment toward the product per day, diverging from a centre line: positive rises in ink,
 * negative falls in red. Neutral, mixed, unclear and unclassified are in the tooltip and table.
 */
export function SentimentChart({ days }: { days: FeedbackDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // One scale for both directions; each half is as tall as its own largest day (220px shared).
  const maxPos = Math.max(0, ...days.map((d) => d.positive)), maxNeg = Math.max(0, ...days.map((d) => d.negative));
  const scale = 220 / Math.max(1, maxPos + maxNeg);
  const HP = Math.max(24, maxPos * scale), HN = Math.max(24, maxNeg * scale);
  return (
    <div className="grid gap-2.5 overflow-x-clip">
      <div className="relative flex gap-[3px] sm:gap-1" style={{ height: HP + HN + 2 }} onMouseLeave={() => setHover(null)}
        role="img" aria-label="Sentiment toward the product per day, with unclassified mentions shown separately. A data table follows.">
        <span className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/15" style={{ top: HP }} aria-hidden />
        {days.map((d, i) => (
          <div key={d.day} className="relative grid min-w-0 flex-1" style={{ gridTemplateRows: `${HP}px 2px ${HN}px` }} onMouseEnter={() => setHover(i)}>
            <span className="flex items-end">
              <span className="grow-y w-full rounded-full bg-gradient-to-b from-foreground/70 to-foreground/30"
                style={vars({ height: `${maxPos ? (d.positive / maxPos) * 100 : 0}%`, "--d": `${300 + i * 18}ms`, opacity: hover === null || hover === i ? 1 : 0.5 })} />
            </span>
            <span />
            <span className="flex items-start">
              <span className="w-full origin-top rounded-full bg-gradient-to-b from-signal to-[color-mix(in_oklab,var(--signal)_70%,white)] shadow-[0_0_14px_color-mix(in_oklab,var(--signal)_45%,transparent)] fade-in"
                style={vars({ height: `${maxNeg ? (d.negative / maxNeg) * 100 : 0}%`, "--d": `${400 + i * 18}ms`, opacity: hover === null || hover === i ? 1 : 0.5 })} />
            </span>
            <Tip show={hover === i} side={i < days.length / 2 ? "left" : "right"} title={long(d.day)}
              lines={[["positive", d.positive, ink(0.7)], ["negative", d.negative, "var(--signal)"], ["neutral, mixed or unclear", d.neutral + d.mixed + d.uncertain], ["not yet classified", d.unclassified]]} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[12px] text-muted-foreground/80"><span>{days[0] && short(days[0].day)}</span><span>{days.at(-1) && short(days.at(-1)!.day)}</span></div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend items={[{ color: ink(0.7), text: "Positive" }, { color: "var(--signal)", text: "Negative", glow: true }]} />
        <TableView caption="Sentiment per day" head={["Day", "Negative", "Neutral", "Mixed", "Unclear", "Positive", "Not classified"]}
          rows={days.map((d) => [d.day, d.negative, d.neutral, d.mixed, d.uncertain, d.positive, d.unclassified])} />
      </div>
    </div>
  );
}

/** A small line for a KPI card (one series, drawn in on first paint). */
export function Spark({ values, red = false }: { values: number[]; red?: boolean }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${34 - (v / max) * 28}`).join(" ");
  return (
    <svg viewBox="0 0 100 40" className="h-9 w-[88px] shrink-0" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={red ? "var(--signal)" : ink(0.75)} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export interface PlatformRow { id: string; name: string; counts: Record<string, number> }
export interface KindCol { key: string; label: string; short: string }

/**
 * Feedback by platform. "All" is a platform × kind bubble grid (area ∝ posts, bugs in red);
 * picking a kind ranks the platforms for just that kind. Every mark opens those posts.
 */
export function PlatformMatrix({ rows, kinds, query }: { rows: PlatformRow[]; kinds: KindCol[]; query: string }) {
  const [tab, setTab] = useState<string>("all");
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const href = (kind: string, source?: string) => `/mentions?${new URLSearchParams({ feedback: kind, ...(source ? { source } : {}) })}${query ? `&${query}` : ""}`;
  const totals = Object.fromEntries(kinds.map((k) => [k.key, rows.reduce((t, r) => t + (r.counts[k.key] ?? 0), 0)]));
  const all = Object.values(totals).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...rows.flatMap((r) => kinds.map((k) => r.counts[k.key] ?? 0)));
  const colorOf = (key: string) => (key === "bugs" ? "var(--signal)" : ink(0.8));

  const tabs = [{ key: "all", label: "All", n: all }, ...kinds.map((k) => ({ key: k.key, label: k.label, n: totals[k.key] ?? 0 }))];
  const ranked = tab === "all" ? [] : rows.map((r) => ({ ...r, n: r.counts[tab] ?? 0 })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  const rankedMax = Math.max(1, ...ranked.map((r) => r.n));
  const kindTotal = tab === "all" ? 0 : totals[tab] ?? 0;

  if (rows.length === 0) {
    return <p className="grid min-h-40 place-content-center rounded-xl border border-dashed px-4 text-center text-[13px] text-muted-foreground">Nothing classified in this period.</p>;
  }
  return (
    <div className="grid gap-5">
      <div role="radiogroup" aria-label="Kind of feedback" className="panel flex w-fit max-w-full flex-wrap gap-0.5 rounded-[22px] p-1 text-[13px]">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="radio" aria-checked={tab === t.key} onClick={() => setTab(t.key)}
            className={cn("press flex h-8 shrink-0 items-center gap-2 rounded-full px-3.5 transition-colors duration-200",
              tab === t.key ? "bg-foreground/[0.09] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" : "text-muted-foreground hover:text-foreground")}>
            {t.key === "bugs" && <span className="size-1.5 rounded-full bg-signal shadow-[var(--signal-glow)]" aria-hidden />}
            {t.label}
            <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", tab === t.key ? "bg-foreground/[0.1]" : "bg-foreground/[0.05]")}>{t.n.toLocaleString("en-US")}</span>
          </button>
        ))}
      </div>

      {tab === "all" ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-separate border-spacing-0 text-[13px]" onMouseLeave={() => setHover(null)}>
            <caption className="sr-only">Classified posts by platform and kind of feedback</caption>
            <thead>
              <tr>
                <th scope="col" className="pb-3 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">Platform</th>
                {kinds.map((k, c) => (
                  <th key={k.key} scope="col" className={cn("pb-3 text-center text-[11px] font-medium transition-colors",
                    hover?.c === c ? "text-foreground" : "text-muted-foreground/80", k.key === "bugs" && "text-signal")}>{k.short}</th>
                ))}
                <th scope="col" className="pb-3 text-right text-[11px] font-medium text-muted-foreground/80">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => {
                const rowTotal = kinds.reduce((t, k) => t + (r.counts[k.key] ?? 0), 0);
                return (
                  <tr key={r.id} className="group">
                    <th scope="row" className={cn("border-t border-foreground/[0.06] py-2 pr-3 text-left font-normal transition-colors",
                      hover?.r === ri ? "text-foreground" : "text-foreground/85")}>{r.name}</th>
                    {kinds.map((k, c) => {
                      const n = r.counts[k.key] ?? 0;
                      const size = 22 + Math.sqrt(n / max) * 18;
                      const lit = hover === null || hover.r === ri || hover.c === c;
                      return (
                        <td key={k.key} className="border-t border-foreground/[0.06] p-0 text-center">
                          {n === 0 ? (
                            <span className="mx-auto block size-1 rounded-full bg-foreground/15" aria-label={`${r.name}, ${k.label}: none`} />
                          ) : (
                            <a href={href(k.key, r.id)} onMouseEnter={() => setHover({ r: ri, c })} onFocus={() => setHover({ r: ri, c })}
                              aria-label={`${r.name}, ${k.label}: ${n} posts`} title={`${r.name} · ${k.label}: ${n}`}
                              className="relative mx-auto flex h-11 items-center justify-center">
                              <span className="flex items-center justify-center rounded-full text-[10px] font-medium tabular-nums transition-[opacity,transform] duration-150"
                                style={vars({
                                  width: size, height: size,
                                  background: k.key === "bugs" ? "var(--signal)" : ink(0.12 + Math.sqrt(n / max) * 0.6),
                                  color: k.key === "bugs" || n / max > 0.4 ? "var(--background)" : "var(--foreground)",
                                  boxShadow: k.key === "bugs" ? "0 0 16px color-mix(in oklab, var(--signal) 55%, transparent)" : undefined,
                                  opacity: lit ? 1 : 0.3, transform: hover?.r === ri && hover?.c === c ? "scale(1.12)" : undefined,
                                })}>
                                {n > 999 ? "1k+" : n}
                              </span>
                            </a>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-t border-foreground/[0.06] py-2 text-right tabular-nums text-muted-foreground">{rowTotal.toLocaleString("en-US")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : ranked.length === 0 ? (
        <p className="grid min-h-40 place-content-center rounded-xl border border-dashed px-4 text-center text-[13px] text-muted-foreground">No {kinds.find((k) => k.key === tab)?.label.toLowerCase()} in this period.</p>
      ) : (
        <ol className="grid gap-1" aria-label={`${kinds.find((k) => k.key === tab)?.label} by platform`}>
          {ranked.map((r, i) => (
            <li key={r.id}>
              <a href={href(tab, r.id)} className="group grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-foreground/[0.04]">
                <span className={cn("text-[12px] tabular-nums", i === 0 ? "font-semibold text-foreground" : "text-muted-foreground/70")}>{String(i + 1).padStart(2, "0")}</span>
                <span className="grid gap-1.5">
                  <span className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="truncate group-hover:underline group-hover:underline-offset-2">{r.name}</span>
                    <span className="text-[12px] tabular-nums text-muted-foreground">{Math.round((r.n / Math.max(1, kindTotal)) * 100)}%</span>
                  </span>
                  <span className="block h-2 overflow-hidden rounded-full bg-foreground/[0.06]" aria-hidden>
                    <span className="grow-x block h-full rounded-full" style={vars({ width: `${(r.n / rankedMax) * 100}%`, "--d": `${i * 50}ms`,
                      background: i === 0 ? colorOf(tab) : ink(0.45), boxShadow: i === 0 && tab === "bugs" ? "var(--signal-glow)" : undefined })} />
                  </span>
                </span>
                <span className="w-10 text-right text-[15px] font-semibold tabular-nums">{r.n.toLocaleString("en-US")}</span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
