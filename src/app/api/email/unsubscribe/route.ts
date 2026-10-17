import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyUnsubscribe } from "@/lib/email/unsubscribe";
import { unsubscribeSecret } from "@/lib/server/agent/state-secret";

// Unsubscribe from weekly report emails with the signed link in each email; no
// sign-in needed. GET only shows a confirmation button (mail scanners open links);
// POST unsubscribes — also used by mail apps' one-click unsubscribe (RFC 8058).

function page(title: string, body: string, status = 200) {
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;color:#1a1a19;line-height:1.5">${body}</body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" } });
}

export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t") ?? "";
  if (!verifyUnsubscribe(unsubscribeSecret(), t)) return page("Link not valid", "<h1 style=\"font-size:20px\">This unsubscribe link isn't valid</h1><p>You can turn emails off in SignalForge under Settings → Account.</p>", 400);
  const action = `/api/email/unsubscribe?t=${encodeURIComponent(t)}`;
  return page("Unsubscribe", `<h1 style="font-size:20px">Stop weekly report emails?</h1><p>You'll stop receiving weekly report emails for this workspace. Reports stay available in SignalForge.</p>
<form method="post" action="${action}"><button type="submit" style="background:#e0571a;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-weight:600;cursor:pointer">Unsubscribe</button></form>`);
}

export async function POST(req: NextRequest) {
  const target = verifyUnsubscribe(unsubscribeSecret(), req.nextUrl.searchParams.get("t") ?? "");
  if (!target) return page("Link not valid", "<h1 style=\"font-size:20px\">This unsubscribe link isn't valid</h1>", 400);
  const admin = createAdminClient();
  const { data: member } = await admin.from("workspace_members").select("user_id").eq("workspace_id", target.w).eq("user_id", target.u).maybeSingle();
  if (member) {
    const { error } = await admin.from("notification_preferences").upsert(
      { workspace_id: target.w, user_id: target.u, channel: "email", weekly_report: false, updated_at: new Date().toISOString() },
      { onConflict: "workspace_id,user_id,channel" },
    );
    if (error) {
      console.error(`[email] unsubscribe failed: ${error.message}`);
      return page("Something went wrong", "<h1 style=\"font-size:20px\">Couldn't unsubscribe</h1><p>Try again, or turn emails off in Settings → Account.</p>", 500);
    }
  }
  return page("Unsubscribed", "<h1 style=\"font-size:20px\">You're unsubscribed</h1><p>No more weekly report emails for this workspace. You can turn them back on in SignalForge under Settings → Account.</p>");
}
