// /llms.txt (https://llmstxt.org): a plain-text guide to Heardex for AI models (src/lib/server/llms.ts).
import { llmsText } from "@/lib/server/llms";

export async function GET() {
  return new Response(await llmsText(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
