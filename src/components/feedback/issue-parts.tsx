import { ExternalLink } from "lucide-react";
import type { PriorityResult } from "@/lib/ai/priority";
import type { FeedbackCategory } from "@/lib/ai/types";
import { integrationInfo } from "@/lib/domain/integrations";
import { formatTime } from "@/lib/format";

// Shared by Feedback Intelligence and Product Insights.

export const nameOf = (id: string) => integrationInfo(id as never)?.name.replace(/ \/ Stack Exchange$/, "") ?? id;
export const PRIORITY_TONE = { critical: "negative", high: "negative", medium: "warning", low: "neutral" } as const;
export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export const STATUS_LABEL: Record<string, string> = { open: "Open", acknowledged: "Acknowledged", resolved: "Resolved", dismissed: "Dismissed" };
export const TREND_LABEL: Record<string, string> = { new: "New this week", worsening: "Worsening", growing: "Growing", steady: "Steady", declining: "Declining" };
/** One issue's kind, in the singular, with the chart colour of its feedback group (bug, feature request, complaint). */
const ISSUE_KIND: Partial<Record<FeedbackCategory, { label: string; color: string }>> = {
  bug_report: { label: "Bug", color: "var(--feedback-bug)" },
  security_concern: { label: "Security concern", color: "var(--feedback-bug)" },
  feature_request: { label: "Feature request", color: "var(--feedback-feature)" },
  complaint: { label: "Complaint", color: "var(--feedback-complaint)" },
  usability_complaint: { label: "Usability complaint", color: "var(--feedback-complaint)" },
  pricing_complaint: { label: "Pricing complaint", color: "var(--feedback-complaint)" },
  performance_issue: { label: "Performance problem", color: "var(--feedback-complaint)" },
};

/** The issue's kind as a neutral chip with a colour dot (the label carries the meaning; the dot links it to the charts). */
export function IssueKind({ category, fallback }: { category: FeedbackCategory; fallback: string }) {
  const k = ISSUE_KIND[category];
  return (
    <span className="panel inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium" data-testid="issue-kind">
      {k && <span className="size-2 rounded-full" style={{ background: k.color }} aria-hidden />}
      {k?.label ?? fallback}
    </span>
  );
}

/** A short, readable day in the viewer's time zone ("Oct 21, 2026"). */
export const day = (iso: string, tz: string) => formatTime(iso, tz, { dateOnly: true });

/** Categories the developer agent and issue drafts work on. */
export const AGENT_CATEGORIES = ["bug_report", "feature_request", "complaint", "usability_complaint", "performance_issue", "security_concern"];

export const CLUSTER_COLS = "id, category, title, report_count, unique_reporters, platforms, sentiment, suggested_priority, confidence, first_detected_at, last_detected_at, status, priority_score, priority_evidence, algorithm";

export type Cluster = {
  id: string; category: FeedbackCategory; title: string; report_count: number; unique_reporters: number | null;
  platforms: string[]; sentiment: string | null; suggested_priority: (typeof PRIORITIES)[number] | null; confidence: number | null;
  first_detected_at: string | null; last_detected_at: string | null; status: string; priority_score: number | null;
  priority_evidence: PriorityResult["evidence"] | null; algorithm: string;
};
export type Member = { id: string; title: string | null; content: string | null; source: string; source_url: string; published_at: string; author_display: string | null };

export function Evidence({ m, tz = "UTC" }: { m: Member; tz?: string }) {
  const text = (m.title || m.content || "").replace(/\s+/g, " ").slice(0, 180);
  return (
    <li className="grid content-between gap-2 rounded-xl border border-foreground/[0.06] bg-foreground/[0.025] p-3 text-xs transition-colors hover:border-foreground/15">
      <a href={m.source_url} target="_blank" rel="noreferrer noopener nofollow" className="inline-flex min-w-0 items-start gap-1.5 leading-relaxed text-foreground/90 underline-offset-2 hover:underline">
        <span className="line-clamp-3">{text || "Untitled post"}</span><ExternalLink className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
      </a>
      <span className="truncate text-[11px] text-muted-foreground">{nameOf(m.source)}{m.author_display ? ` · ${m.author_display}` : ""} · {day(m.published_at, tz)}</span>
    </li>
  );
}

/** What was measured vs what the AI inferred behind an issue's priority. */
export function PriorityEvidence({ ev, testLabels, open = false }: { ev: PriorityResult["evidence"]; testLabels: boolean; open?: boolean }) {
  return (
    <details className="text-xs" data-testid="priority-evidence" open={open}>
      <summary className="cursor-pointer text-muted-foreground">Why this priority</summary>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        <div>
          <p className="font-medium">Observed in collected posts</p>
          <ul className="list-disc pl-4 text-muted-foreground">
            <li>{ev.observed.independent_reporters} independent reporters, {ev.observed.mentions} posts</li>
            <li>{ev.observed.last_7_days} posts in the last 7 days, {ev.observed.previous_7_days} the week before</li>
            <li>{ev.observed.recurring ? `Recurring: ${ev.observed.weeks_active} different weeks` : `Active in ${ev.observed.weeks_active} week${ev.observed.weeks_active === 1 ? "" : "s"}`}</li>
            <li>{Math.round(ev.observed.negative_share * 100)}% of classified posts negative</li>
          </ul>
        </div>
        <div>
          <p className="font-medium">Inferred by AI{testLabels ? " (test classifier)" : ""}</p>
          <ul className="list-disc pl-4 text-muted-foreground">
            <li>Severity: {ev.inferred.severity}{ev.inferred.severity !== "unknown" && ` (${Object.entries(ev.inferred.severity_votes).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(", ")})`}</li>
            {ev.inferred.area && <li>Affected area: {ev.inferred.area}</li>}
            <li>Confidence: {Math.round(ev.inferred.confidence * 100)}%</li>
          </ul>
        </div>
      </div>
    </details>
  );
}
