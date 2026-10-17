import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleStripeEvent, verifyWebhook } from "@/lib/server/billing/stripe";

// Stripe webhook endpoint. Every request must carry a valid Stripe signature over
// the raw body (5-minute tolerance); nothing else is trusted. Processing is
// idempotent per event id; a 500 makes Stripe retry.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const event = verifyWebhook(raw, req.headers.get("stripe-signature"));
  if (!event) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  try {
    const outcome = await handleStripeEvent(createAdminClient(), event);
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    console.error(`[stripe] ${event.type} ${event.id} failed: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
