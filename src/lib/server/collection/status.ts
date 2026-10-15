import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_SOURCES } from "@/lib/sources/registry";
import type { PublicSourceId } from "@/lib/sources/types";
import { sourceSetup } from "./sources";

export type CoverageState = "live" | "partial" | "failing" | "not_configured" | "not_started";

export interface SourceCoverage {
  id: PublicSourceId;
  name: string;
  state: CoverageState;
  /** Human explanation for anything other than "live". */
  detail?: string;
  lastCoveredAt?: string;
  note?: string;
}

export interface CoverageSummary {
  sources: SourceCoverage[];
  /** Sources whose data is in this product's numbers. */
  included: SourceCoverage[];
  /** Included, but the latest window is incomplete or failed. */
  degraded: SourceCoverage[];
  excluded: SourceCoverage[];
}

/** Coverage is "stale" when the newest window ended this long ago (missed runs ⇒ don't treat as zero). */
const STALE_MS = 2 * 86_400_000 + 3_600_000;

/**
 * Per-source coverage for a product, from coverage windows (what was actually
 * searched) plus server configuration. Reads through RLS.
 */
export const getCoverageSummary = cache(async (productId: string): Promise<CoverageSummary> => {
  const supabase = await createClient();
  const setup = sourceSetup();
  const latest = await Promise.all(
    PUBLIC_SOURCES.map(async (id) => {
      const { data } = await supabase
        .from("coverage_windows")
        .select("status, detail, window_end")
        .eq("product_id", productId)
        .eq("provider", id)
        .order("window_end", { ascending: false })
        .limit(1)
        .maybeSingle();
      return [id, data] as const;
    }),
  );
  const byId = new Map(latest);

  const sources = setup.map((s): SourceCoverage => {
    const w = byId.get(s.id) as { status: string; detail: string | null; window_end: string } | null | undefined;
    const base = { id: s.id, name: s.name, note: s.note, lastCoveredAt: w?.window_end };
    if (!s.configured) return { ...base, state: "not_configured", detail: s.reason };
    if (!w) return { ...base, state: "not_started", detail: "No scan has run for this source yet." };
    if (w.status === "failed") return { ...base, state: "failing", detail: w.detail ?? "The latest collection run failed." };
    if (Date.now() - new Date(w.window_end).getTime() > STALE_MS) {
      return { ...base, state: "failing", detail: "Monitoring hasn't completed recently; recent days may be missing." };
    }
    if (w.status === "partial") return { ...base, state: "partial", detail: w.detail ?? "Some results were not collected." };
    return { ...base, state: "live" };
  });

  const included = sources.filter((s) => s.state === "live" || s.state === "partial" || (s.state === "failing" && s.lastCoveredAt));
  return {
    sources,
    included,
    degraded: included.filter((s) => s.state !== "live"),
    excluded: sources.filter((s) => !included.includes(s)),
  };
});

export interface ScanJob {
  id: string;
  provider: PublicSourceId | null;
  query: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "dead" | "canceled";
  waiting: boolean;
  lastError: string | null;
  result: {
    fetched?: number;
    filtered?: number;
    inserted?: number;
    updated?: number;
    duplicates?: number;
    overLimit?: number;
    complete?: boolean;
    incompleteReason?: string;
    skipped?: string;
  } | null;
}

export interface ScanStatus {
  id: string;
  createdAt: string;
  lookbackDays: number;
  jobs: ScanJob[];
  done: boolean;
}

/**
 * Latest scan for a product with per-job progress. The scan row is read
 * through RLS (authorization); job → query mapping needs the service role
 * because job payloads are not exposed to clients.
 */
export async function getLatestScan(productId: string): Promise<ScanStatus | null> {
  const supabase = await createClient();
  const { data: scan } = await supabase
    .from("scans")
    .select("id, created_at, lookback_days, workspace_id")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!scan) return null;

  const admin = createAdminClient();
  const { data: jobs } = await admin
    .from("jobs")
    .select("id, status, result, last_error, payload, run_after, attempts")
    .eq("scan_id", scan.id)
    .eq("workspace_id", scan.workspace_id)
    .order("created_at", { ascending: true });
  const queryIds = [...new Set((jobs ?? []).map((j) => (j.payload as { query_id?: string })?.query_id).filter(Boolean))] as string[];
  const { data: queries } = queryIds.length
    ? await admin.from("monitoring_queries").select("id, provider, query").in("id", queryIds).eq("workspace_id", scan.workspace_id)
    : { data: [] as Array<{ id: string; provider: PublicSourceId; query: string }> };
  const qById = new Map((queries ?? []).map((q) => [q.id, q]));

  const list: ScanJob[] = (jobs ?? []).map((j) => {
    const q = qById.get((j.payload as { query_id?: string })?.query_id ?? "");
    return {
      id: j.id,
      provider: (q?.provider as PublicSourceId | undefined) ?? null,
      query: q?.query ?? null,
      status: j.status,
      // Queued again after a rate limit: say so instead of looking stuck.
      waiting: j.status === "queued" && Boolean(j.last_error) && new Date(j.run_after).getTime() > Date.now(),
      lastError: j.last_error,
      result: j.result,
    };
  });
  return {
    id: scan.id,
    createdAt: scan.created_at,
    lookbackDays: scan.lookback_days,
    jobs: list,
    done: list.every((j) => j.status === "succeeded" || j.status === "dead" || j.status === "canceled"),
  };
}
