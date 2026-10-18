// Customer-facing Claude connection states (pure). Detailed internal states
// (OAuth grant, first MCP call, repository, routine) stay available to the
// page's "Manage connection" view; the card shows just one of these.

export type ClaudeState = "not_connected" | "connecting" | "connected" | "needs_attention" | "unavailable";

export const CLAUDE_STATE_LABEL: Record<ClaudeState, string> = {
  not_connected: "Not connected",
  connecting: "Connecting",
  connected: "Connected",
  needs_attention: "Needs attention",
  unavailable: "Unavailable",
};

/**
 * Claude's web and desktop apps reach custom connectors from Anthropic's cloud,
 * so SignalForge must be served at a public HTTPS address.
 */
export function publiclyReachable(siteUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(siteUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".test") || h.endsWith(".internal")) return false;
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$)/.test(h) || h === "[::1]") return false;
  return true;
}

export interface ConnectionFacts {
  /** An unrevoked OAuth grant exists (the user approved access in SignalForge). */
  authorized: boolean;
  /** Claude has actually called SignalForge with that grant (a real MCP connection). */
  used: boolean;
  routineError: string | null;
  reachable: boolean;
}

/** "Connected" only after a real, authorized MCP call — never on approval alone. */
export function claudeState(f: ConnectionFacts): ClaudeState {
  if (f.used) return f.routineError ? "needs_attention" : "connected";
  if (f.authorized) return "connecting";
  return f.reachable ? "not_connected" : "unavailable";
}
