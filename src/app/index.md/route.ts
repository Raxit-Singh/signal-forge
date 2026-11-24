// The home page in Markdown (https://acceptmarkdown.com): the proxy rewrites / here for requests that prefer
// text/markdown. The same text as /llms.txt.
import { llmsText } from "@/lib/server/llms";

export async function GET() {
  return new Response(await llmsText(), {
    headers: { "content-type": "text/markdown; charset=utf-8", vary: "Accept", "cache-control": "public, max-age=3600" },
  });
}
