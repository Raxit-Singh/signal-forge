import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TaskStatus, RunStatus } from "@/lib/sources/backfill-plan";
import { integrationInfo, type IntegrationProvider } from "@/lib/domain/integrations";

export interface BackfillPlatform {
  platform: string;
  name: string;
  status: TaskStatus;
  /** Searches (query groups) on this platform, by status. */
  searches: number;
  done: number;
  inserted: number;
  results: number;
  supportedSince: string | null;
  notes: string[];
  /** Oldest point reached so far while searching (the cursor's end). */
  reachedBack: string | null;
}

export interface BackfillStatus {
  id: string;
  mode: string;
  rangeStart: string;
  rangeEnd: string;
  status: RunStatus;
  pauseReason: string | null;
  createdAt: string;
  completedAt: string | null;
  inserted: number;
  platforms: BackfillPlatform[];
}

const ORDER: TaskStatus[] = ["searching", "queued", "paused", "partial", "unavailable", "completed"];

/** Platform status from its searches: the least finished one wins. */
export function platformStatus(statuses: TaskStatus[]): TaskStatus {
  if (statuses.some((s) => s === "searching")) return "searching";
  if (statuses.some((s) => s === "queued")) return statuses.some((s) => s !== "queued") ? "searching" : "queued";
  if (statuses.some((s) => s === "paused")) return "paused";
  if (statuses.every((s) => s === "unavailable")) return "unavailable";
  if (statuses.some((s) => s === "partial" || s === "unavailable")) return "partial";
  return "completed";
}

/** Latest historical search of a product with per-platform progress (read through RLS). */
export async function getBackfillStatus(productId: string): Promise<BackfillStatus | null> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("backfill_runs")
    .select("id, mode, range_start, range_end, status, pause_reason, created_at, completed_at")
    .eq("product_id", productId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!run) return null;
  const { data: tasks } = await supabase.from("backfill_tasks")
    .select("platform, status, inserted, results, supported_since, note, cursor")
    .eq("run_id", run.id);
  const by = new Map<string, Array<{ status: TaskStatus; inserted: number; results: number; supported_since: string | null; note: string | null; cursor: { until?: string } | null }>>();
  for (const t of (tasks ?? []) as Array<{ platform: string; status: TaskStatus; inserted: number; results: number; supported_since: string | null; note: string | null; cursor: { until?: string } | null }>) {
    if (!by.has(t.platform)) by.set(t.platform, []);
    by.get(t.platform)!.push(t);
  }
  const platforms: BackfillPlatform[] = [...by].map(([platform, ts]) => {
    const status = platformStatus(ts.map((t) => t.status));
    const reached = ts.map((t) => t.cursor?.until).filter((x): x is string => Boolean(x)).sort();
    return {
      platform, name: integrationInfo(platform as IntegrationProvider)?.name ?? platform, status,
      searches: ts.length, done: ts.filter((t) => ["completed", "partial", "unavailable"].includes(t.status)).length,
      inserted: ts.reduce((a, t) => a + t.inserted, 0), results: ts.reduce((a, t) => a + t.results, 0),
      supportedSince: ts.map((t) => t.supported_since).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null,
      notes: [...new Set(ts.map((t) => t.note).filter((n): n is string => Boolean(n)))].slice(0, 3),
      reachedBack: status === "searching" ? reached.at(-1) ?? null : null,
    };
  }).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.inserted - a.inserted || a.name.localeCompare(b.name));
  return {
    id: run.id as string, mode: run.mode as string, rangeStart: run.range_start as string, rangeEnd: run.range_end as string,
    status: run.status as RunStatus, pauseReason: (run.pause_reason as string | null) ?? null,
    createdAt: run.created_at as string, completedAt: (run.completed_at as string | null) ?? null,
    inserted: platforms.reduce((a, p) => a + p.inserted, 0), platforms,
  };
}

/** Relevant mentions per day this product collected recently, when it has been monitored long enough to say. */
export async function measuredDailyRate(productId: string, now = new Date()): Promise<{ perDay: number; overDays: number } | null> {
  const supabase = await createClient();
  const { data: first } = await supabase.from("coverage_windows").select("window_start")
    .eq("product_id", productId).eq("status", "complete").order("window_start", { ascending: true }).limit(1).maybeSingle();
  if (!first) return null;
  const overDays = Math.min(7, Math.floor((now.getTime() - new Date(first.window_start as string).getTime()) / 86_400_000));
  if (overDays < 3) return null;
  const { count } = await supabase.from("mentions").select("id", { count: "exact", head: true })
    .eq("product_id", productId).eq("dedup_kind", "original").in("relevance_status", ["relevant", "user_relevant"])
    .gte("published_at", new Date(now.getTime() - overDays * 86_400_000).toISOString());
  return { perDay: (count ?? 0) / overDays, overDays };
}
