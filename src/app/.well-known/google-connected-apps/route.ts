// Google Connected Apps (Gemini) domain check: the console shows a token, served here as
// {"verification_tokens": [...]}. Set GOOGLE_CONNECTED_APPS_TOKENS in Vercel (comma-separated); 404 until set.
export const dynamic = "force-dynamic";

export function GET() {
  const tokens = (process.env.GOOGLE_CONNECTED_APPS_TOKENS ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return new Response("Not found", { status: 404 });
  return Response.json({ verification_tokens: tokens }, { headers: { "cache-control": "no-store" } });
}
