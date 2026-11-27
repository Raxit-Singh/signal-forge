"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { getActiveWorkspace, getUser } from "@/lib/server/session";
import { serverEnv } from "@/lib/server/env";
import { publicEnv } from "@/lib/env";
import { LEGAL } from "@/lib/legal";
import {
  BUG_MESSAGE_MAX, BUG_MESSAGE_MIN, BUG_REPORTS_PER_HOUR, BUG_SCREENSHOT_MAX_BYTES, BUG_SCREENSHOT_TYPES,
  bugReportEmail, cleanPagePath,
} from "@/lib/bug-report";

const bugSchema = z.object({
  message: z.string().trim().min(BUG_MESSAGE_MIN, "Tell us a little more about what happened.").max(BUG_MESSAGE_MAX, "That's too long; keep it under 5,000 characters."),
  page: z.string().max(2048).optional(),
});

/** Saves a bug report and emails it to support (reply goes to the reporter). Signed-in users only. */
export async function reportBugAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return failure("Your session has expired. Sign in again.");
  const parsed = bugSchema.safeParse({ message: formData.get("message") ?? "", page: formData.get("page") ?? undefined });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form.", fields: { message: parsed.error.issues[0]?.message ?? "" } };

  const file = formData.get("screenshot");
  const shot = file instanceof File && file.size > 0 ? file : null;
  if (shot && (shot.size > BUG_SCREENSHOT_MAX_BYTES || !(BUG_SCREENSHOT_TYPES as readonly string[]).includes(shot.type))) {
    return failure("The screenshot couldn't be attached. Try a smaller PNG or JPEG, or send the report without it.");
  }

  const admin = createAdminClient();
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await admin.from("bug_reports").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= BUG_REPORTS_PER_HOUR) return failure(`You've sent ${BUG_REPORTS_PER_HOUR} reports in the last hour. Write to ${LEGAL.email} if it's urgent.`);

  const workspace = await getActiveWorkspace();
  const ua = (await headers()).get("user-agent")?.slice(0, 500) ?? null;
  const pagePath = cleanPagePath(parsed.data.page);
  const { data: row, error } = await admin.from("bug_reports").insert({
    workspace_id: workspace?.id ?? null, user_id: user.id, reporter_email: user.email ?? null, message: parsed.data.message,
    page_url: pagePath, user_agent: ua, screenshot_name: shot ? "screenshot" : null,
  }).select("id").single();
  if (error || !row) {
    logServerError("reportBug", error);
    return failure(`Couldn't send the report. Try again, or write to ${LEGAL.email}.`);
  }

  // Email support; the report is saved either way.
  const env = serverEnv();
  let email_status: "sent" | "skipped" | "failed" = "skipped";
  let email_error: string | null = null;
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    const mail = bugReportEmail({
      id: row.id as number, message: parsed.data.message, reporterEmail: user.email ?? null, workspaceName: workspace?.name ?? null,
      pagePath, userAgent: ua, screenshot: Boolean(shot), siteUrl: publicEnv.NEXT_PUBLIC_SITE_URL,
    });
    try {
      const ext = shot?.type === "image/png" ? "png" : shot?.type === "image/webp" ? "webp" : "jpg";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `bug-${row.id}` },
        body: JSON.stringify({
          from: env.EMAIL_FROM, to: [LEGAL.email], reply_to: user.email ?? undefined, subject: mail.subject, html: mail.html, text: mail.text,
          attachments: shot ? [{ filename: `bug-${row.id}.${ext}`, content: Buffer.from(await shot.arrayBuffer()).toString("base64") }] : undefined,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) email_status = "sent";
      else {
        email_status = "failed";
        email_error = `Resend ${res.status}`;
      }
    } catch (e) {
      email_status = "failed";
      email_error = (e instanceof Error ? e.message : "network error").slice(0, 500);
    }
  }
  await admin.from("bug_reports").update({ email_status, email_error }).eq("id", row.id);
  if (email_status === "failed") logServerError("reportBug.email", email_error);

  return { status: "success", message: "Thanks. We got your report and will reply by email." };
}

/** Marks the app tour as finished (or skipped) for the signed-in user. Replaying it doesn't reset this. */
export async function completeTourAction(): Promise<void> {
  const user = await getUser();
  if (!user) return;
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ tour_completed_at: new Date().toISOString() }).eq("id", user.id).is("tour_completed_at", null);
  if (error) logServerError("completeTour", error);
}
