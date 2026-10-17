import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { weeklyReportEmail } from "@/lib/email/templates";
import { unsubscribeToken } from "@/lib/email/unsubscribe";
import type { ReportData } from "@/lib/reports/weekly";
import { unsubscribeSecret } from "@/lib/server/agent/state-secret";
import { site } from "@/lib/server/agent/http";
import { sendEmail } from "./send";

/**
 * Emails a weekly report to the workspace's members, except those who turned
 * weekly report emails off. Each person gets it at most once (dedupe key).
 */
export async function emailWeeklyReport(admin: SupabaseClient, reportId: string): Promise<{ sent: number; skipped: number; failed: number }> {
  const out = { sent: 0, skipped: 0, failed: 0 };
  const { data: r } = await admin.from("reports").select("id, workspace_id, kind, status, data").eq("id", reportId).maybeSingle();
  if (!r || r.kind !== "weekly" || r.status !== "ready" || !r.data) return out;
  const [{ data: members }, { data: prefs }] = await Promise.all([
    admin.from("workspace_members").select("user_id, profiles:user_id(email)").eq("workspace_id", r.workspace_id),
    admin.from("notification_preferences").select("user_id, weekly_report").eq("workspace_id", r.workspace_id).eq("channel", "email"),
  ]);
  const off = new Set((prefs ?? []).filter((p) => p.weekly_report === false).map((p) => p.user_id as string));
  for (const m of members ?? []) {
    const userId = m.user_id as string;
    const email = (m.profiles as unknown as { email: string | null } | null)?.email;
    if (!email || off.has(userId)) continue;
    const unsubscribe = `${site()}/api/email/unsubscribe?t=${unsubscribeToken(unsubscribeSecret(), { u: userId, w: r.workspace_id as string, k: "weekly_report" })}`;
    const result = await sendEmail(admin, {
      to: email, kind: "weekly_report", workspaceId: r.workspace_id as string, userId, dedupeKey: `weekly:${r.id}:${userId}`,
      email: weeklyReportEmail(r.data as ReportData, { report: `${site()}/reports/${r.id}`, unsubscribe, settings: `${site()}/settings/account` }),
      headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    if (result === "sent") out.sent++;
    else if (result === "failed") out.failed++;
    else out.skipped++;
  }
  return out;
}
