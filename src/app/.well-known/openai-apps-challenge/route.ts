// OpenAI plugin directory domain check: the portal's "Connect MCP server" step shows a token, which must be
// served here as plain text, nothing else. Set OPENAI_APPS_CHALLENGE in Vercel; 404 until it is set.
export const dynamic = "force-dynamic";

export function GET() {
  const token = process.env.OPENAI_APPS_CHALLENGE?.trim();
  if (!token) return new Response("Not found", { status: 404 });
  return new Response(token, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
