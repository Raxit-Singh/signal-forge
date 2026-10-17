// Email templates (pure). Every value from users or collected posts is escaped;
// links are built from the site URL only. Each email has a plain-text part.

import type { ReportData } from "../reports/weekly.ts";

export interface Email { subject: string; html: string; text: string }

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Subjects are a single line without control characters. */
const line = (s: string, max = 150) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);

function layout(title: string, body: string, footer: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a19">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e6e2;border-radius:8px">
<tr><td style="padding:24px 24px 8px;font-size:13px;color:#6b6b66">SignalForge</td></tr>
<tr><td style="padding:0 24px 24px;font-size:14px;line-height:1.55">${body}</td></tr>
</table>
<p style="max-width:560px;font-size:12px;color:#6b6b66;line-height:1.5;margin:12px auto 0">${footer}</p>
</td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#e0571a;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600">${esc(label)}</a>`;

const ROLE: Record<string, string> = { admin: "an admin", member: "a member", viewer: "a viewer (read-only)" };

export function invitationEmail(i: { workspace: string; inviter: string | null; role: string; link: string; expires: Date }): Email {
  const who = i.inviter ? `${i.inviter} invited you` : "You've been invited";
  const until = i.expires.toUTCString().slice(5, 16);
  return {
    subject: line(`Join ${i.workspace} on SignalForge`),
    html: layout(`Join ${i.workspace}`, `
<h1 style="font-size:18px;margin:0 0 12px">Join ${esc(i.workspace)}</h1>
<p>${esc(who)} to join <strong>${esc(i.workspace)}</strong> on SignalForge as ${esc(ROLE[i.role] ?? i.role)}.</p>
<p style="margin:20px 0">${button(i.link, "Accept invitation")}</p>
<p style="font-size:12px;color:#6b6b66">The link works once, for this email address, until ${esc(until)}. If you weren't expecting it, ignore this email.</p>`,
    `You received this because someone entered your address in SignalForge.`),
    text: `${who} to join ${i.workspace} on SignalForge as ${ROLE[i.role] ?? i.role}.\n\nAccept: ${i.link}\n\nThe link works once, for this email address, until ${until}. If you weren't expecting it, ignore this email.`,
  };
}

export function weeklyReportEmail(d: ReportData, links: { report: string; unsubscribe: string; settings: string }): Email {
  const kpi = (label: string, value: number) => `<td style="padding:8px 12px 8px 0"><div style="font-size:12px;color:#6b6b66">${esc(label)}</div><div style="font-size:18px;font-weight:600">${value.toLocaleString("en-US")}</div></td>`;
  const issues = d.issues.slice(0, 5);
  return {
    subject: line(`${d.product.name}: weekly report, ${d.period.label}`),
    html: layout(`${d.product.name} weekly report`, `
<h1 style="font-size:18px;margin:0 0 4px">${esc(d.product.name)} — weekly report</h1>
<p style="margin:0 0 16px;font-size:12px;color:#6b6b66">${esc(d.period.label)}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr>${kpi("Relevant mentions", d.current.mentions)}${kpi("Unique authors", d.current.uniqueAuthors)}${kpi("Negative", d.current.sentiment.negative)}</tr></table>
<ul style="padding-left:18px;margin:12px 0">${d.highlights.map((h) => `<li style="margin:4px 0">${esc(h)}</li>`).join("")}</ul>
${issues.length ? `<p style="margin:16px 0 4px;font-weight:600">Issues with activity</p><ul style="padding-left:18px;margin:0">${issues.map((i) => `<li style="margin:4px 0">${esc(i.title)} <span style="color:#6b6b66">· ${i.postsInPeriod} post${i.postsInPeriod === 1 ? "" : "s"}${i.isNew ? " · new" : ""}</span></li>`).join("")}</ul>` : ""}
<p style="margin:20px 0">${button(links.report, "Open the full report")}</p>`,
    `Numbers come from the same stored data as your dashboards. <a href="${esc(links.unsubscribe)}" style="color:#6b6b66">Unsubscribe from weekly reports</a> · <a href="${esc(links.settings)}" style="color:#6b6b66">Email settings</a>`),
    text: [
      `${d.product.name} — weekly report (${d.period.label})`, "",
      `Relevant mentions: ${d.current.mentions}`, `Unique authors: ${d.current.uniqueAuthors}`, `Negative: ${d.current.sentiment.negative}`, "",
      ...d.highlights.map((h) => `- ${h}`), "",
      ...(issues.length ? ["Issues with activity:", ...issues.map((i) => `- ${i.title} (${i.postsInPeriod} posts${i.isNew ? ", new" : ""})`), ""] : []),
      `Full report: ${links.report}`, "", `Unsubscribe from weekly reports: ${links.unsubscribe}`,
    ].join("\n"),
  };
}
