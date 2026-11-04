import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleDodoEvent, verifyWebhook } from "@/lib/server/billing/dodo";

// Dodo Payments webhook endpoint. Every request must carry a valid Standard Webhooks
// signature over the raw body (5-minute tolerance); nothing else is trusted.
// Processing is idempotent per webhook id; a 500 makes Dodo retry.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const event = verifyWebhook(raw, req.headers);
  if (!event) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  try {
    const outcome = await handleDodoEvent(createAdminClient(), event);
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    console.error(`[dodo] ${event.type} ${event.id} failed: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
