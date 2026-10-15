import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/server/env";
import { tick } from "@/lib/server/collection/worker";

// Called by the scheduler (Supabase Cron → pg_net, or any cron) every few
// minutes. Authenticated by a shared secret; excluded from the session proxy.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BUDGET_MS = 50_000;

function authorized(req: NextRequest, secret: string) {
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(req: NextRequest) {
  const secret = serverEnv().JOBS_TICK_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: "Scheduler secret not configured" }, { status: 503 });
  }
  if (!authorized(req, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await tick(BUDGET_MS);
    return NextResponse.json(summary);
  } catch (e) {
    console.error(`[tick] ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: "Tick failed" }, { status: 500 });
  }
}
