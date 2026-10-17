import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server/env";
import type { Email } from "@/lib/email/templates";

/** Email is sent only when the server has a Resend key and a verified sender address. */
export function emailConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

type Fetch = typeof fetch;

/**
 * Sends one email through Resend (or records "skipped" when email isn't set up)
 * and logs the outcome. `dedupeKey` makes a resend of the same email a no-op
 * (and is Resend's idempotency key). Never throws: email is best effort.
 */
export async function sendEmail(admin: SupabaseClient, m: {
  to: string; kind: "invitation" | "weekly_report"; email: Email; workspaceId: string | null; userId?: string | null;
  dedupeKey: string; headers?: Record<string, string>;
}, fetchImpl: Fetch = fetch): Promise<"sent" | "skipped" | "failed" | "duplicate"> {
  const { data: seen } = await admin.from("email_log").select("status").eq("dedupe_key", m.dedupeKey).maybeSingle();
  if (seen && seen.status !== "failed") return "duplicate";
  const log = async (status: "sent" | "skipped" | "failed", extra: { provider_message_id?: string; error?: string } = {}) => {
    const row = { workspace_id: m.workspaceId, user_id: m.userId ?? null, recipient: m.to, kind: m.kind, subject: m.email.subject, dedupe_key: m.dedupeKey, status, ...extra };
    if (seen) await admin.from("email_log").update(row).eq("dedupe_key", m.dedupeKey);
    else await admin.from("email_log").insert(row);
    return status;
  };
  const env = serverEnv();
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return log("skipped", { error: "Email isn't configured on this server" });
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": m.dedupeKey.slice(0, 256) },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [m.to], subject: m.email.subject, html: m.email.html, text: m.email.text, headers: m.headers }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) return log("failed", { error: `Resend ${res.status}: ${String(body.message ?? body.name ?? "").slice(0, 300)}` });
    return log("sent", { provider_message_id: body.id });
  } catch (e) {
    return log("failed", { error: (e instanceof Error ? e.message : "network error").slice(0, 300) });
  }
}
