// Feedback Intelligence groups → the stored categories behind them, so a count
// on the Feedback page links to exactly the posts it counted. Same grouping as
// the feedback_daily SQL function. Pure.

export const FEEDBACK_FILTERS = {
  bugs: { label: "Bug reports", categories: ["bug_report"] },
  features: { label: "Feature requests", categories: ["feature_request"] },
  complaints: { label: "Complaints", categories: ["complaint", "usability_complaint", "pricing_complaint", "performance_issue"] },
  praise: { label: "Praise", categories: ["positive_review"] },
  questions: { label: "Questions", categories: ["support_question"] },
  comparisons: { label: "Competitor comparisons", categories: ["competitor_comparison"] },
  general: { label: "General discussion / other", categories: ["general_discussion", "other"] },
} as const;

export type FeedbackFilterKey = keyof typeof FEEDBACK_FILTERS;

export function isFeedbackFilter(v: unknown): v is FeedbackFilterKey {
  return typeof v === "string" && Object.hasOwn(FEEDBACK_FILTERS, v);
}

/** Date range parameters a link carries over (the top bar's `range`, and `from`/`to` for a custom range). */
export type RangeParams = Partial<Record<"range" | "from" | "to", string>>;

/** Mentions page link listing the posts behind a Feedback Intelligence count, over the same date range. */
export function feedbackMentionsHref(key: FeedbackFilterKey, range: RangeParams = {}): string {
  const p = new URLSearchParams({ feedback: key });
  for (const k of ["range", "from", "to"] as const) if (range[k]) p.set(k, range[k]!);
  return `/mentions?${p}`;
}
