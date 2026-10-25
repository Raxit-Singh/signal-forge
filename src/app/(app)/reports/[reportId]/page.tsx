import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Download, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/server/session";
import { change, type PeriodNumbers, type ReportData } from "@/lib/reports/weekly";
import { categoryLabel } from "@/lib/ai/cluster";
import { uuidSchema } from "@/lib/validation/schemas";
import { formatCount, formatTime } from "@/lib/format";
import { getTimeZone } from "@/lib/server/timezone";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { nameOf, PRIORITY_TONE } from "@/components/feedback/issue-parts";
import { PrintButton } from "../print-button";

export const metadata: Metadata = { title: "Report" };

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Highlights written before spikes and coverage were hidden from customers are left out. */
const shown = (h: string) => !/confirmed spike|Monitoring covered/.test(h);

function Kpi({ label, now, before, cov, i, red = false }: { label: string; now: number; before: number; cov: { current: number; previous: number }; i: number; red?: boolean }) {
  const c = change(now, before, cov);
  const up = c.pct !== null && c.pct >= 0;
  return (
    <div className="panel rise grid min-w-0 content-start gap-2 rounded-[18px] p-4 break-inside-avoid" style={{ ["--d" as string]: `${120 + i * 50}ms` }} data-testid="report-kpi">
      <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
        {red && <span className="size-1.5 rounded-full bg-signal shadow-[var(--signal-glow)]" aria-hidden />}{label}
      </span>
      <span className="text-[28px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{formatCount(now)}</span>
      <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
        {c.pct !== null ? (
          <>
            <span className={up ? (red ? "text-signal" : "text-positive") : red ? "text-positive" : "text-signal"}>
              {up ? <ArrowUpRight className="inline size-3.5" aria-hidden /> : <ArrowDownRight className="inline size-3.5" aria-hidden />}{c.pct > 0 ? "+" : ""}{c.pct}%
            </span>
            vs the week before
          </>
        ) : `${formatCount(before)} the week before`}
      </span>
    </div>
  );
}

function Panel({ title, sub, children, testId, className = "", d = 0 }: { title: string; sub?: string; children: React.ReactNode; testId?: string; className?: string; d?: number }) {
  return (
    <section className={`panel rise grid content-start gap-4 rounded-[18px] p-5 break-inside-avoid ${className}`} style={{ ["--d" as string]: `${d}ms` }} data-testid={testId}>
      <div className="grid gap-1">
        <h2 className="text-[13px] text-muted-foreground">{title}</h2>
        {sub && <p className="text-[12px] text-muted-foreground/80">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

/** One week's sentiment as a split bar: negative (red), neutral/mixed, positive. */
function SentimentBar({ label, n }: { label: string; n: PeriodNumbers }) {
  const s = n.sentiment;
  const mid = s.neutral + s.mixed + s.uncertain;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span>{label}</span>
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {s.classified ? <><span className="text-signal">{pct(s.negative / s.classified)} negative</span> · {pct(s.positive / s.classified)} positive</> : "Not classified"}
        </span>
      </div>
      {s.classified > 0 ? (
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`${label}: ${s.negative} negative, ${mid} neutral or mixed, ${s.positive} positive`}>
          <span className="rounded-full bg-signal" style={{ width: `${(s.negative / s.classified) * 100}%` }} />
          <span className="rounded-full bg-foreground/20" style={{ width: `${(mid / s.classified) * 100}%` }} />
          <span className="rounded-full bg-foreground/75" style={{ width: `${(s.positive / s.classified) * 100}%` }} />
        </div>
      ) : <div className="h-3 rounded-full bg-foreground/[0.06]" />}
    </div>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const tz = await getTimeZone();
  const at = (d: string | Date) => formatTime(d, tz);
  const { reportId } = await params;
  if (!uuidSchema.safeParse(reportId).success) notFound();
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: row } = await supabase.from("reports").select("id, kind, data, status").eq("id", reportId).eq("workspace_id", workspace.id).maybeSingle();
  if (!row?.data) notFound();
  const d = row.data as ReportData;
  const cov = { current: d.current.coverage, previous: d.previous.coverage };
  const maxDay = Math.max(1, ...d.daily.map((x) => x.mentions));
  const negNow = d.current.sentiment.classified ? d.current.sentiment.negative : 0;
  const peakDay = d.daily.reduce((b, x, i) => (x.mentions > d.daily[b]!.mentions ? i : b), 0);
  const fb = [
    { label: "Bug reports", now: d.current.feedback.bugs, before: d.previous.feedback.bugs, red: true },
    { label: "Feature requests", now: d.current.feedback.features, before: d.previous.feedback.features },
    { label: "Complaints", now: d.current.feedback.complaints, before: d.previous.feedback.complaints },
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 pb-10 print:gap-3">
      <Link href="/reports" className="press inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground print:hidden"><ArrowLeft className="size-3.5" aria-hidden />Reports</Link>
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1.5">
          <p className="text-[13px] text-muted-foreground">{row.kind === "weekly" ? "Weekly report" : "Report: last 7 days"} · {d.period.label}</p>
          <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">{d.product.name}</h1>
          <p className="text-[12px] text-muted-foreground/80">Computed {at(d.generatedAt)} · SignalForge</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintButton />
          <Button asChild variant="secondary"><a href={`/reports/${row.id}/csv`} download><Download aria-hidden />Download CSV</a></Button>
        </div>
      </header>

      <section className="panel rise relative grid gap-3 overflow-hidden rounded-[18px] p-5 sm:p-6 break-inside-avoid" style={{ ["--d" as string]: "60ms" }} data-testid="report-highlights">
        <span className="pointer-events-none absolute -left-20 -top-24 size-56 rounded-full bg-signal/10 blur-3xl print:hidden" aria-hidden />
        <h2 className="relative text-[13px] text-muted-foreground">This week in short</h2>
        <ul className="relative grid gap-2.5">
          {d.highlights.filter(shown).map((h, i) => (
            <li key={h} className={`flex gap-3 ${i === 0 ? "text-[20px] font-medium leading-snug tracking-[-0.015em]" : "text-[14px] text-foreground/90"}`}>
              <span className={`mt-[0.55em] size-1.5 shrink-0 rounded-full ${i === 0 ? "bg-signal shadow-[var(--signal-glow)]" : "bg-foreground/40"}`} aria-hidden />
              {h}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi i={0} label="Relevant mentions" now={d.current.mentions} before={d.previous.mentions} cov={cov} />
        <Kpi i={1} label="Unique authors" now={d.current.uniqueAuthors} before={d.previous.uniqueAuthors} cov={cov} />
        <Kpi i={2} label="Engagement" now={d.current.engagement} before={d.previous.engagement} cov={cov} />
        <Kpi i={3} label="Negative mentions" now={negNow} before={d.previous.sentiment.negative} cov={cov} red />
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 print:grid-cols-2">
        <Panel title="Mentions per day" sub={d.daily[peakDay] ? `Busiest: ${d.daily[peakDay]!.day.slice(5)} with ${formatCount(d.daily[peakDay]!.mentions)}` : undefined} d={300}>
          <div className="flex items-end gap-2" style={{ height: 150 }} aria-hidden>
            {d.daily.map((x, i) => (
              <div key={x.day} className="grid h-full min-w-0 flex-1 grid-rows-[1fr_auto] justify-items-center gap-1.5">
                <span className="flex w-full items-end justify-center">
                  <span className={`block w-full max-w-7 rounded-full ${i === peakDay ? "bg-foreground" : "bg-foreground/35"}`} style={{ height: `${Math.max(4, (x.mentions / maxDay) * 100)}%` }} />
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{x.day.slice(8)}</span>
              </div>
            ))}
          </div>
          <table className="sr-only">
            <caption>Relevant mentions per day</caption>
            <tbody>{d.daily.map((x) => <tr key={x.day}><th scope="row">{x.day}</th><td>{x.mentions}</td></tr>)}</tbody>
          </table>
        </Panel>
        <Panel title="By platform" d={360}>
          {d.current.bySource.length === 0 ? <p className="text-[13px] text-muted-foreground">No mentions.</p> : (
            <table className="w-full text-[13px]">
              <caption className="sr-only">Mentions by platform</caption>
              <tbody>
                {d.current.bySource.map((x, i) => (
                  <tr key={x.source}>
                    <td className="w-[38%] py-1.5 pr-3">{nameOf(x.source)}</td>
                    <td className="py-1.5 pr-3" aria-hidden>
                      <span className="block h-2 overflow-hidden rounded-full bg-foreground/[0.07]">
                        <span className={`block h-full rounded-full ${i === 0 ? "bg-foreground" : "bg-foreground/45"}`} style={{ width: `${d.current.mentions ? (x.mentions / d.current.mentions) * 100 : 0}%` }} />
                      </span>
                    </td>
                    <td className="w-12 py-1.5 text-right tabular-nums">{formatCount(x.mentions)}</td>
                    <td className="w-12 py-1.5 text-right tabular-nums text-muted-foreground">{d.current.mentions ? pct(x.mentions / d.current.mentions) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 print:grid-cols-2">
        <Panel title="Sentiment" sub="Toward the product, classified mentions only." d={420}>
          <div className="grid gap-4">
            <SentimentBar label="This week" n={d.current} />
            <SentimentBar label="Week before" n={d.previous} />
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground" aria-label="Legend">
            <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-signal" aria-hidden />Negative</li>
            <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-foreground/20" aria-hidden />Neutral or mixed</li>
            <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-foreground/75" aria-hidden />Positive</li>
          </ul>
        </Panel>
        <Panel title="Feedback" sub="Classified posts this week, and the week before." d={480}>
          <ul className="grid grid-cols-3 gap-3">
            {fb.map((f) => (
              <li key={f.label} className="grid gap-1 rounded-2xl bg-foreground/[0.03] p-3">
                <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  {f.red && <span className="size-1.5 rounded-full bg-signal" aria-hidden />}{f.label}
                </span>
                <span className="text-[24px] font-semibold leading-none tabular-nums">{formatCount(f.now)}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{formatCount(f.before)} before</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Issues with activity this week" testId="report-issues" d={540}>
        {d.issues.length === 0 ? <p className="text-[13px] text-muted-foreground">No grouped issues had posts this week.</p> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {d.issues.map((i) => {
              const hot = i.priority === "critical" || i.priority === "high";
              return (
                <li key={i.id} className="relative flex items-center gap-3 overflow-hidden rounded-2xl bg-foreground/[0.03] py-3 pl-4 pr-3 text-[13px]">
                  <span className={`absolute inset-y-3 left-0 w-[3px] rounded-r-full ${hot ? "bg-signal" : "bg-foreground/25"}`} aria-hidden />
                  <span className="grid min-w-0 flex-1 gap-1">
                    <Link href={`/insights/${i.id}`} className="truncate font-medium underline-offset-2 hover:underline print:no-underline">{i.title}</Link>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="info">{categoryLabel(i.category as never)}</Badge>
                      {i.priority && <Badge tone={PRIORITY_TONE[i.priority as keyof typeof PRIORITY_TONE] ?? "neutral"}>{i.priority}</Badge>}
                      {i.isNew && <Badge tone="warning">New</Badge>}
                    </span>
                  </span>
                  <span className="grid shrink-0 justify-items-end leading-none">
                    <span className={`text-[22px] font-semibold tabular-nums ${hot ? "text-signal" : ""}`}>{i.postsInPeriod}</span>
                    <span className="mt-1 text-[11px] text-muted-foreground">post{i.postsInPeriod === 1 ? "" : "s"} · {i.reporters} people</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 print:grid-cols-2">
        <Panel title="Share of voice" d={600}>
          {!d.competitors ? <p className="text-[13px] text-muted-foreground">No competitors tracked. <Link href="/competitors" className="underline underline-offset-2 print:hidden">Add competitors</Link></p> : (
            <>
              <ul className="grid gap-2.5">
                {d.competitors.rows.map((r) => (
                  <li key={r.name} className="grid gap-1.5 text-[13px]">
                    <span className="flex justify-between gap-2"><span>{r.name}{r.isProduct ? " (you)" : ""}</span><span className="tabular-nums text-muted-foreground">{formatCount(r.mentions)}{r.share !== null && ` · ${pct(r.share)}`}</span></span>
                    <span className="block h-2 overflow-hidden rounded-full bg-foreground/[0.07]" aria-hidden>
                      <span className={`block h-full rounded-full ${r.isProduct ? "bg-signal" : "bg-foreground/45"}`} style={{ width: `${(r.share ?? 0) * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-muted-foreground/80">On {d.competitors.sources.map(nameOf).join(", ")}.</p>
            </>
          )}
        </Panel>
        <Panel title="Most engaged posts" d={660}>
          {d.topPosts.length === 0 ? <p className="text-[13px] text-muted-foreground">None.</p> : (
            <ol className="grid gap-2.5">
              {d.topPosts.map((p, i) => (
                <li key={p.url} className="flex gap-3 text-[13px]">
                  <span className="w-5 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="grid min-w-0 gap-0.5">
                    <a href={p.url} target="_blank" rel="noreferrer noopener nofollow" className="inline-flex items-center gap-1 truncate underline-offset-2 hover:underline">{p.title}<ExternalLink className="size-3 shrink-0 print:hidden" aria-hidden /></a>
                    <span className="text-[11px] text-muted-foreground">{nameOf(p.source)} · {p.publishedAt.slice(0, 10)} · engagement {formatCount(p.engagement)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <p className="px-1 text-[12px] text-muted-foreground/80">
        Counts are relevant, deduplicated mentions published in the period (UTC), from the same data as the dashboards, compared with the week before.
        Highlights are written by fixed rules from these numbers, not by AI.
      </p>
    </div>
  );
}
