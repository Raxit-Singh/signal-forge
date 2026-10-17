// Claude Code routine API trigger (pure; fetch injected for tests).
//
// Documented at platform.claude.com/docs/en/api/claude-code/routines-fire
// (experimental). The customer creates a routine at claude.ai/code/routines with
// their repository and the SignalForge connector, adds an API trigger, and gives
// SignalForge the URL and per-routine token. Runs bill to the customer's Claude
// subscription. The endpoint only starts a session: there is no API to read its
// status or result, so results come back through SignalForge's MCP tools.
// There is no idempotency key: each successful fire starts a new session.

type FetchLike = typeof fetch;

export const ROUTINE_FIRE_RE = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/(trig_[A-Za-z0-9]{8,64})\/fire$/;
/** Development only: a local stand-in for the fire endpoint (used by browser tests). */
const DEV_FIRE_RE = /^http:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}\/api\/dev\/mock-routine\/(trig_[A-Za-z0-9]{8,64})\/fire$/;
export const ROUTINE_TOKEN_RE = /^sk-ant-oat01-[A-Za-z0-9_-]{20,300}$/;

export function parseFireUrl(url: string, allowDev: boolean): { routineId: string } | null {
  const m = ROUTINE_FIRE_RE.exec(url.trim()) ?? (allowDev ? DEV_FIRE_RE.exec(url.trim()) : null);
  return m ? { routineId: m[1]! } : null;
}

export type FireResult =
  | { ok: true; sessionId: string; sessionUrl: string }
  | { ok: false; kind: "auth" | "paused_or_invalid" | "forbidden" | "not_found" | "rate_limited" | "unavailable"; message: string; retryAfterSeconds?: number };

export async function fireRoutine(fireUrl: string, token: string, text: string, opts: { fetch?: FetchLike } = {}): Promise<FireResult> {
  const f = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(fireUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "experimental-cc-routine-2026-04-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: text.slice(0, 65_536) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, kind: "unavailable", message: "Couldn't reach Claude Code." };
  }
  const body = (await res.json().catch(() => null)) as { type?: string; claude_code_session_id?: string; claude_code_session_url?: string; error?: { message?: string } } | null;
  if (res.ok && body?.type === "routine_fire" && body.claude_code_session_id && body.claude_code_session_url?.startsWith("https://")) {
    return { ok: true, sessionId: body.claude_code_session_id, sessionUrl: body.claude_code_session_url };
  }
  const msg = (body?.error?.message ?? "").slice(0, 200);
  switch (res.status) {
    case 401: return { ok: false, kind: "auth", message: "Claude Code rejected the routine token. Generate a new token for the routine and save it again." };
    case 400: return { ok: false, kind: "paused_or_invalid", message: `Claude Code refused the request${msg ? `: ${msg}` : ""} (the routine may be paused).` };
    case 403: return { ok: false, kind: "forbidden", message: "This Claude account or organization can't use routine API triggers." };
    case 404: return { ok: false, kind: "not_found", message: "The routine doesn't exist any more." };
    case 429: return { ok: false, kind: "rate_limited", message: "The routine's hourly run limit was reached.", retryAfterSeconds: Number(res.headers.get("retry-after")) || 3600 };
    default: return { ok: false, kind: "unavailable", message: `Claude Code returned an error (${res.status}).` };
  }
}
