import { devRoutineAllowed } from "@/lib/server/agent/tasks";

// DEVELOPMENT ONLY: a stand-in for GitHub's issue search so browser tests can
// exercise the "Already on GitHub?" check without calling GitHub. Only the
// reserved e2e-fixture/* repositories are routed here. 404 in production and on Vercel.
export async function GET(req: Request) {
  if (!devRoutineAllowed()) return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (!/^repo:e2e-fixture\/[A-Za-z0-9._-]+ is:issue /.test(q)) return Response.json({ message: "Validation Failed" }, { status: 422 });
  if (q.startsWith("repo:e2e-fixture/private ")) return Response.json({ message: "Validation Failed" }, { status: 422 });
  const repo = q.slice(5, q.indexOf(" "));
  const items = [
    { number: 41, title: "App freezes on the login screen", state: "open", comments: 4, updated_at: "2026-10-10T00:00:00Z" },
    { number: 17, title: "Login page typo", state: "closed", comments: 1, updated_at: "2026-09-01T00:00:00Z" },
    { number: 9, title: "Add dark mode", state: "open", comments: 9, updated_at: "2026-08-01T00:00:00Z" },
    { number: 50, title: "Login freeze fix", state: "closed", comments: 0, updated_at: "2026-10-12T00:00:00Z", pull_request: {} },
  ].map((i) => ({ ...i, html_url: `https://github.com/${repo}/issues/${i.number}` }));
  return Response.json({ total_count: items.length, incomplete_results: false, items });
}
