// Development-only monitoring entitlement (pure; reads an env-like record).
//
// Lets a developer test faster refresh intervals than their plan allows on a
// local dev server. It only lowers the plan's minimum interval used by Smart
// Monitoring for explicitly listed workspaces. It never touches API budgets,
// paid allowances, rate limiters or source minimums (YouTube), and it is inert
// unless ALL of these hold:
//   * NODE_ENV === "development" (`next dev`; production builds are never "development")
//   * not a Vercel production/preview deployment (VERCEL_ENV unset or "development")
//   * DEV_MONITORING_MIN_INTERVAL_MINUTES is one of 60/120/180/240/360/720
//   * the workspace id is listed in DEV_MONITORING_WORKSPACES (no wildcard)

const STEPS = [60, 120, 180, 240, 360, 720];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function devMonitoringFloor(env: Record<string, string | undefined>, workspaceId: string): number | null {
  if (env.NODE_ENV !== "development") return null;
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "development") return null;
  const minutes = Number(env.DEV_MONITORING_MIN_INTERVAL_MINUTES);
  if (!STEPS.includes(minutes)) return null;
  const allowed = (env.DEV_MONITORING_WORKSPACES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => UUID.test(s));
  return allowed.includes(workspaceId.toLowerCase()) ? minutes : null;
}
