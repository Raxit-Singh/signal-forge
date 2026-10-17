import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/server/session";
import { change, type PeriodNumbers, type ReportData } from "@/lib/reports/weekly";
import { categoryLabel } from "@/lib/ai/cluster";
import { uuidSchema } from "@/lib/validation/schemas";
import { formatCount, formatUtc } from "@/lib/format";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { nameOf, PRIORITY_TONE } from "@/components/feedback/issue-parts";
import { PrintButton } from "../print-button";

export const metadata: Metadata = { title: "Report" };

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Kpi({ label, now, before, cov }: { label: string; now: number; before: number; cov: { current: number; previous: number } }) {
  const c = change(now, before, cov);
  return (
    <Card className="grid min-w-0 gap-0.5 p-3 break-inside-avoid" data-testid="report-kpi">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular">{formatCount(now)}</span>
      <span className="text-xs text-muted-foreground">{c.pct !== null ? c.note : `${formatCount(before)} the week before${c.note.startsWith("not") ? " (not comparable)" : ""}`}</span>
    </Card>
  );
}

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <Card className="break-inside-avoid" data-testid={testId}>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SentimentRow({ label, n }: { label: string; n: PeriodNumbers }) {
  const s = n.sentiment;
  return (
    <tr>
      <th scope="row" className="py-1 pr-3 text-left font-normal">{label}</th>
      <td className="py-1 pr-3 text-right tabular">{formatCount(s.classified)}</td>
      <td className="py-1 pr-3 text-right tabular">{s.classified ? pct(s.positive / s.classified) : "—"}</td>
      <td className="py-1 pr-3 text-right tabular">{s.classified ? pct((s.neutral + s.mixed + s.uncertain) / s.classified) : "—"}</td>
      <td className="py-1 pr-3 text-right tabular">{s.classified ? pct(s.negative / s.classified) : "—"}</td>
      <td className="py-1 pr-3 text-right tabular">{formatCount(n.feedback.bugs)}</td>
      <td className="py-1 pr-3 text-right tabular">{formatCount(n.feedback.features)}</td>
      <td className="py-1 text-right tabular">{formatCount(n.feedback.complaints)}</td>
    </tr>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ reportId: string }> }) {
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

  return (
    <div className="grid gap-4 print:gap-3">
      <Link href="/reports" className="inline-flex w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground print:hidden"><ArrowLeft className="size-3.5" aria-hidden />Reports</Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <p className="text-xs text-muted-foreground">{row.kind === "weekly" ? "Weekly report" : "Report: last 7 days"} · SignalForge</p>
          <h1 className="text-xl font-semibold tracking-tight">{d.product.name}</h1>
          <p className="text-[13px] text-muted-foreground">{d.period.label} · computed {formatUtc(d.generatedAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintButton />
          <Button asChild size="sm" variant="secondary"><a href={`/reports/${row.id}/csv`} download><Download aria-hidden />Download CSV</a></Button>
        </div>
      </header>

      <Section title="Highlights" testId="report-highlights">
        <ul className="grid list-disc gap-1 pl-5 text-[13px]">{d.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
      </Section>

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Relevant mentions" now={d.current.mentions} before={d.previous.mentions} cov={cov} />
        <Kpi label="Unique authors" now={d.current.uniqueAuthors} before={d.previous.uniqueAuthors} cov={cov} />
        <Kpi label="Engagement" now={d.current.engagement} before={d.previous.engagement} cov={cov} />
        <Kpi label="Negative mentions" now={negNow} before={d.previous.sentiment.negative} cov={cov} />
      </section>

      <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
        <Section title="Mentions per day">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Relevant mentions per day</caption>
            <tbody>
              {d.daily.map((x) => (
                <tr key={x.day}>
                  <th scope="row" className="w-24 py-0.5 pr-2 text-left font-normal text-muted-foreground">{x.day.slice(5)}</th>
                  <td className="py-0.5"><div className="h-2 rounded-sm bg-[var(--entity-1)]" style={{ width: `${(x.mentions / maxDay) * 100}%` }} aria-hidden /></td>
                  <td className="w-12 py-0.5 pl-2 text-right tabular">{formatCount(x.mentions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="By platform">
          {d.current.bySource.length === 0 ? <p className="text-[13px] text-muted-foreground">No mentions.</p> : (
            <table className="w-full text-[13px]">
              <thead className="text-xs text-muted-foreground"><tr><th className="py-1 text-left font-medium">Platform</th><th className="py-1 text-right font-medium">Mentions</th><th className="py-1 text-right font-medium">Share</th></tr></thead>
              <tbody>
                {d.current.bySource.map((s) => (
                  <tr key={s.source}><td className="py-0.5">{nameOf(s.source)}</td><td className="py-0.5 text-right tabular">{formatCount(s.mentions)}</td><td className="py-0.5 text-right tabular">{d.current.mentions ? pct(s.mentions / d.current.mentions) : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Monitoring covered {pct(d.current.coverage)} of this week and {pct(d.previous.coverage)} of the week before.</p>
        </Section>
      </div>

      <Section title="Sentiment and feedback">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[13px]">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="py-1 text-left font-medium" /><th className="py-1 pr-3 text-right font-medium">Classified</th><th className="py-1 pr-3 text-right font-medium">Positive</th><th className="py-1 pr-3 text-right font-medium">Neutral/mixed</th><th className="py-1 pr-3 text-right font-medium">Negative</th><th className="py-1 pr-3 text-right font-medium">Bugs</th><th className="py-1 pr-3 text-right font-medium">Requests</th><th className="py-1 text-right font-medium">Complaints</th></tr>
            </thead>
            <tbody>
              <SentimentRow label="This week" n={d.current} />
              <SentimentRow label="Week before" n={d.previous} />
            </tbody>
          </table>
        </div>
        {d.current.sentiment.unclassified > 0 && <p className="mt-2 text-xs text-muted-foreground">{formatCount(d.current.sentiment.unclassified)} mentions this week weren&apos;t classified and aren&apos;t in these shares.</p>}
      </Section>

      <Section title="Issues with activity this week" testId="report-issues">
        {d.issues.length === 0 ? <p className="text-[13px] text-muted-foreground">No grouped issues had posts this week.</p> : (
          <ul className="grid gap-1.5 text-[13px]">
            {d.issues.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/insights/${i.id}`} className="font-medium underline-offset-2 hover:underline print:no-underline">{i.title}</Link>
                <Badge tone="info">{categoryLabel(i.category as never)}</Badge>
                {i.priority && <Badge tone={PRIORITY_TONE[i.priority as keyof typeof PRIORITY_TONE] ?? "neutral"}>{i.priority}</Badge>}
                {i.isNew && <Badge tone="warning">New</Badge>}
                <span className="text-xs text-muted-foreground">{i.postsInPeriod} post{i.postsInPeriod === 1 ? "" : "s"} this week · {i.reporters} reporters</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
        <Section title="Spikes">
          {d.spikes.length === 0 ? <p className="text-[13px] text-muted-foreground">No unusual rises in mentions.</p> : (
            <ul className="grid gap-1 text-[13px]">
              {d.spikes.map((s, k) => (
                <li key={k}>{formatUtc(s.start)} · {s.keyword ? `“${s.keyword}”` : s.platform ? nameOf(s.platform) : "all platforms"}: {s.observed} mentions vs ~{s.expected} usual <span className="text-xs text-muted-foreground">({s.confidence})</span></li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Share of voice">
          {!d.competitors ? <p className="text-[13px] text-muted-foreground">No competitors tracked. <Link href="/competitors" className="underline underline-offset-2 print:hidden">Add competitors</Link></p> : (
            <>
              <ul className="grid gap-1 text-[13px]">
                {d.competitors.rows.map((r) => (
                  <li key={r.name} className="flex justify-between gap-2"><span>{r.name}{r.isProduct ? " (you)" : ""}</span><span className="tabular text-muted-foreground">{formatCount(r.mentions)}{r.share !== null && ` · ${pct(r.share)}`}</span></li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">On {d.competitors.sources.map(nameOf).join(", ")}.</p>
            </>
          )}
        </Section>
      </div>

      <Section title="Most engaged posts">
        {d.topPosts.length === 0 ? <p className="text-[13px] text-muted-foreground">None.</p> : (
          <ol className="grid list-decimal gap-1 pl-5 text-[13px]">
            {d.topPosts.map((p) => (
              <li key={p.url}>
                <a href={p.url} target="_blank" rel="noreferrer noopener nofollow" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">{p.title}<ExternalLink className="size-3 print:hidden" aria-hidden /></a>
                <span className="text-xs text-muted-foreground"> · {nameOf(p.source)} · {p.publishedAt.slice(0, 10)} · engagement {formatCount(p.engagement)}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <p className="text-xs text-muted-foreground">
        How this report is made: counts are relevant, deduplicated mentions published in the period (UTC), from the same stored data as the dashboards,
        compared with the week before. Sentiment and feedback counts cover classified mentions only. Highlights are written by fixed rules from these numbers, not by AI.
      </p>
    </div>
  );
}
