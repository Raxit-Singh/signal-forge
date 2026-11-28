// Wording of the bell's notifications (pure, for tests). Stored by src/lib/server/notifications.ts.

export type NotificationKind = "spike" | "negative_sentiment" | "bug" | "feature_cluster" | "report_ready" | "integration_error" | "system";

const n = (x: number) => x.toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function allowanceNotice(level: "ok" | "warning" | "critical" | "exhausted", percent: number, allowance: number, periodEnd: string):
  { title: string; body: string } | null {
  if (level === "ok") return null;
  if (level === "exhausted") {
    return {
      title: "Mention allowance used up",
      body: `All ${n(allowance)} mentions for this period are in. New ones are held, not lost, until it renews on ${day(periodEnd)} or you change plan.`,
    };
  }
  return {
    title: `${percent}% of this period's mentions used`,
    body: `${n(allowance)} mentions are included until ${day(periodEnd)}. After that, new mentions are held until it renews.`,
  };
}

export function backfillNotice(productName: string, inserted: number, status: "completed" | "partial" | "unavailable"): { title: string; body: string } {
  if (inserted === 0) {
    return {
      title: `History search finished for ${productName}`,
      body: status === "unavailable" ? "None of the platforms could be searched this time. Monitoring carries on." : "No earlier mentions turned up. New ones will appear as they're posted.",
    };
  }
  return {
    title: `History search finished for ${productName}`,
    body: `${n(inserted)} earlier mention${inserted === 1 ? "" : "s"} found${status === "partial" ? ", though some platforms could only be searched in part" : ""}.`,
  };
}

export function newIssuesNotice(productName: string, issues: Array<{ title: string; category: string }>): { title: string; body: string; kind: NotificationKind } | null {
  if (issues.length === 0) return null;
  const isBug = (c: string) => c === "bug_report" || c === "performance_issue" || c === "security_concern";
  const kindOf = (c: string): NotificationKind => (isBug(c) ? "bug" : "feature_cluster");
  if (issues.length === 1) {
    const i = issues[0]!;
    return { kind: kindOf(i.category), title: `New ${isBug(i.category) ? "bug" : i.category === "feature_request" ? "feature request" : "issue"} in ${productName}`, body: i.title };
  }
  const bugs = issues.filter((i) => isBug(i.category)).length;
  return {
    kind: bugs > 0 ? "bug" : "feature_cluster",
    title: `${issues.length} new issues in ${productName}`,
    body: issues.slice(0, 3).map((i) => i.title).join(" · ") + (issues.length > 3 ? ` and ${issues.length - 3} more` : ""),
  };
}

export function spikeNotice(productName: string, observed: number, expected: number, periodStart: string): { title: string; body: string } {
  const times = expected > 0 ? observed / expected : null;
  return {
    title: `More talk about ${productName} than usual`,
    body: `${n(observed)} mentions on ${day(periodStart)}${times && times >= 1.5 ? `, about ${times >= 10 ? Math.round(times) : times.toFixed(1)}× a normal day` : ""}.`,
  };
}
