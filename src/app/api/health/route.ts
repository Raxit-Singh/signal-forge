import { createClient } from "@supabase/supabase-js";

// For an uptime monitor: 200 when the site is up and can reach its database, 503 when it can't. It reads one public
// row (the plans anyone can see) with the public key, so it needs no secret and shows nothing private.
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.from("plans").select("id").limit(1).abortSignal(AbortSignal.timeout(5000));
    if (error) throw new Error(error.message);
    return Response.json({ ok: true, database: "up", ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, database: "down", ms: Date.now() - started }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
