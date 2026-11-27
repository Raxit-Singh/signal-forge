// "Report a bug": what the form may send and the email support receives (pure, for tests).

export const BUG_MESSAGE_MIN = 5;
export const BUG_MESSAGE_MAX = 5000;
/** Screenshots are shrunk in the browser to fit under the server-action body limit (256 KB) with the text. */
export const BUG_SCREENSHOT_MAX_BYTES = 200_000;
export const BUG_SCREENSHOT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Reports one person may send per hour. */
export const BUG_REPORTS_PER_HOUR = 5;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Only a path inside the app is kept (no other sites, no query strings that might carry tokens). */
export function cleanPagePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, "https://app.invalid");
    if (u.origin !== "https://app.invalid" && !/^https?:\/\/(www\.)?heardex\.com$|^http:\/\/localhost(:\d+)?$/.test(u.origin)) return null;
    return u.pathname.slice(0, 500);
  } catch {
    return null;
  }
}

export interface BugReportEmail { subject: string; html: string; text: string }

export function bugReportEmail(r: {
  id: number; message: string; reporterEmail: string | null; workspaceName: string | null; pagePath: string | null;
  userAgent: string | null; screenshot: boolean; siteUrl: string;
}): BugReportEmail {
  const firstLine = r.message.trim().split("\n")[0]!.replace(/\s+/g, " ").slice(0, 70);
  const subject = `Bug #${r.id}: ${firstLine}`;
  const rows: Array<[string, string]> = [
    ["From", r.reporterEmail ?? "unknown"],
    ["Workspace", r.workspaceName ?? "none"],
    ["Page", r.pagePath ? `${r.siteUrl}${r.pagePath}` : "unknown"],
    ["Browser", r.userAgent ?? "unknown"],
    ["Screenshot", r.screenshot ? "attached" : "none"],
  ];
  const text = [r.message.trim(), "", ...rows.map(([k, v]) => `${k}: ${v}`), "", "Reply to this email to answer the reporter."].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#0b0b0c;max-width:640px">
<p style="white-space:pre-wrap;margin:0 0 16px">${esc(r.message.trim())}</p>
<table cellpadding="0" cellspacing="0" style="font-size:13px;color:#63636b;border-top:1px solid #e4e4e8;padding-top:12px">
${rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;vertical-align:top">${k}</td><td style="padding:2px 0;word-break:break-all">${esc(v)}</td></tr>`).join("\n")}
</table>
<p style="font-size:12px;color:#63636b;margin-top:16px">Reply to this email to answer the reporter.</p>
</div>`;
  return { subject, html, text };
}
