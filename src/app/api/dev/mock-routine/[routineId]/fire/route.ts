import { randomUUID } from "node:crypto";
import { devRoutineAllowed } from "@/lib/server/agent/tasks";

// DEVELOPMENT ONLY: a stand-in for Claude Code's routine fire endpoint so browser
// tests can exercise the workflow without a Claude account. It starts nothing; it
// answers like the documented endpoint. 404 in production builds and on Vercel.
export async function POST(req: Request, { params }: { params: Promise<{ routineId: string }> }) {
  if (!devRoutineAllowed()) return new Response("Not found", { status: 404 });
  const { routineId } = await params;
  if (!/^Bearer sk-ant-oat01-[A-Za-z0-9_-]{20,}$/.test(req.headers.get("authorization") ?? "")) {
    return Response.json({ type: "error", error: { type: "authentication_error", message: "bad token" } }, { status: 401 });
  }
  if (req.headers.get("anthropic-version") !== "2023-06-01") return Response.json({ type: "error", error: { type: "invalid_request_error", message: "anthropic-version" } }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  if (!/^signalforge-task: [0-9a-f-]{36}$/.test(body.text ?? "")) return Response.json({ type: "error", error: { type: "invalid_request_error", message: "unexpected text" } }, { status: 400 });
  const id = `session_dev${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  return Response.json({ type: "routine_fire", claude_code_session_id: id, claude_code_session_url: `https://claude.ai/code/${id}`, routine: routineId });
}
