import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectEvidence, sha256, MIN_EVIDENCE, type EvidenceMention } from "@/lib/ai/pipeline";
import {
  clusterSummaryPrompt, clusterSummarySchema, PROMPT_VERSION, spikeExplanationPrompt, spikeExplanationSchema, validateCitedOutput,
  type CitedFinding, type EvidenceInput,
} from "@/lib/ai/prompts";
import { AiError } from "@/lib/ai/types";
import { emitEvent } from "@/lib/server/collection/monitor";
import { budgetedCall, cacheGet, cachePut, resolveAi } from "./gateway";
import { productContext } from "./classify";

export type InvestigationKind = "spike_explanation" | "cluster_summary";

export interface InvestigationReport {
  summary: string;
  findings: CitedFinding[];
  confidence?: "low" | "medium" | "high";
  /** Every post the model was shown; findings cite a subset. */
  evidence: Array<{ mention_id: string; url: string; source: string; title: string | null; published_at: string }>;
  dropped_findings: number;
  test_classifier: boolean;
  prompt_version: string;
}

export const spikeSubject = (s: { granularity: string; platform: string | null; periodStart: string }) =>
  `${s.granularity}|${s.platform ?? "all"}|${new Date(s.periodStart).toISOString()}`;

export function parseSpikeSubject(key: string): { granularity: "day" | "hour"; platform: string | null; periodStart: string } | null {
  const [g, p, start] = key.split("|");
  if ((g !== "day" && g !== "hour") || !p || !start || Number.isNaN(Date.parse(start))) return null;
  return { granularity: g, platform: p === "all" ? null : p, periodStart: start };
}

/**
 * Creates (or re-queues) an on-demand analysis and enqueues its job. Analyses
 * that already completed are kept unless `force` (a re-run spends again).
 */
export async function requestInvestigation(
  admin: SupabaseClient, opts: { workspaceId: string; productId: string; kind: InvestigationKind; subjectKey: string; clusterId?: string | null; title: string; userId: string; force?: boolean },
): Promise<{ id: string; status: string }> {
  const { data: existing } = await admin.from("ai_investigations").select("id, status")
    .eq("product_id", opts.productId).eq("kind", opts.kind).eq("subject_key", opts.subjectKey).maybeSingle();
  let id = existing?.id as string | undefined;
  if (existing && !opts.force && ["pending", "running", "completed"].includes(existing.status as string)) return { id: id!, status: existing.status as string };
  if (existing && ["pending", "running"].includes(existing.status as string)) return { id: id!, status: existing.status as string };
  if (id) {
    await admin.from("ai_investigations").update({ status: "pending", error: null, requested_by: opts.userId, completed_at: null }).eq("id", id);
  } else {
    const { data, error } = await admin.from("ai_investigations").insert({
      workspace_id: opts.workspaceId, product_id: opts.productId, kind: opts.kind, subject_key: opts.subjectKey,
      cluster_id: opts.clusterId ?? null, title: opts.title.slice(0, 200), status: "pending", requested_by: opts.userId,
    }).select("id").single();
    if (error || !data) throw new Error(`create investigation: ${error?.message}`);
    id = data.id as string;
  }
  const { error: qErr } = await admin.rpc("svc_enqueue_job", {
    p_kind: "ai.investigate", p_idempotency_key: `ai.investigate:${id}:${Date.now()}`, p_payload: { investigation_id: id },
    p_workspace_id: opts.workspaceId, p_product_id: opts.productId, p_run_after: new Date().toISOString(), p_priority: 50,
  });
  if (qErr) throw new Error(`enqueue investigation: ${qErr.message}`);
  return { id: id!, status: "pending" };
}

type MentionRow = {
  id: string; source: string; source_url: string; title: string | null; content: string | null;
  published_at: string; engagement_score: number | null; ai_about_product: "yes" | "no" | "unsure" | null;
};
const MENTION_COLS = "id, source, source_url, title, content, published_at, engagement_score, ai_about_product";

async function spikeEvidence(admin: SupabaseClient, productId: string, subject: NonNullable<ReturnType<typeof parseSpikeSubject>>) {
  const { data: spike } = await admin.from("buzz_spikes").select("period_start, period_end, observed, expected, platform")
    .eq("product_id", productId).eq("granularity", subject.granularity).eq("period_start", subject.periodStart)
    .then((r) => ({ data: (r.data ?? []).find((s) => (s.platform ?? null) === subject.platform) ?? null }));
  const start = subject.periodStart;
  const end = spike?.period_end ?? new Date(Date.parse(start) + (subject.granularity === "day" ? 86_400_000 : 3_600_000)).toISOString();
  let q = admin.from("mentions").select(MENTION_COLS).eq("product_id", productId).eq("dedup_kind", "original")
    .in("relevance_status", ["relevant", "pending", "user_relevant"]).gte("published_at", start).lt("published_at", end)
    .eq("published_at_estimated", false).order("engagement_score", { ascending: false }).limit(200);
  if (subject.platform) q = q.eq("source", subject.platform);
  const { data } = await q;
  return { rows: (data ?? []) as MentionRow[], spike: { observed: Number(spike?.observed ?? data?.length ?? 0), expected: Number(spike?.expected ?? 0), start, end } };
}

async function clusterEvidence(admin: SupabaseClient, clusterId: string) {
  const { data: cluster } = await admin.from("feedback_clusters").select("id, category, title").eq("id", clusterId).maybeSingle();
  const { data: members } = await admin.from("feedback_cluster_members").select("mention_id").eq("cluster_id", clusterId).limit(200);
  const ids = (members ?? []).map((m) => m.mention_id as string);
  const { data } = ids.length ? await admin.from("mentions").select(MENTION_COLS).in("id", ids) : { data: [] };
  return { cluster, rows: (data ?? []) as MentionRow[] };
}

const toEvidence = (rows: MentionRow[]): EvidenceMention[] => rows.map((m) => ({
  id: m.id, source: m.source, publishedAt: new Date(m.published_at).toISOString(), title: m.title, content: m.content,
  engagementScore: Number(m.engagement_score ?? 0), aiAboutProduct: m.ai_about_product,
}));

async function finish(admin: SupabaseClient, id: string, patch: Record<string, unknown>) {
  await admin.from("ai_investigations").update({ ...patch, completed_at: new Date().toISOString() }).eq("id", id);
}

/**
 * Runs one analysis. Fewer than MIN_EVIDENCE usable posts, or a model answer
 * whose findings don't cite them, ends as "insufficient data" — never as an
 * uncited claim. A model failure marks only this analysis failed.
 */
export async function runInvestigation(admin: SupabaseClient, investigationId: string): Promise<{ status: string }> {
  const { data: inv } = await admin.from("ai_investigations").select("id, workspace_id, product_id, kind, subject_key, cluster_id, status").eq("id", investigationId).maybeSingle();
  if (!inv) return { status: "missing" };
  if (inv.status === "completed") return { status: "completed" };
  const product = await productContext(admin, inv.product_id as string);
  if (!product) return { status: "missing" };
  await admin.from("ai_investigations").update({ status: "running" }).eq("id", inv.id);

  let rows: MentionRow[] = [];
  let build: (evidence: EvidenceInput[]) => { system: string; user: string };
  let kind: InvestigationKind;
  if (inv.kind === "spike_explanation") {
    kind = "spike_explanation";
    const subject = parseSpikeSubject(inv.subject_key as string);
    if (!subject) {
      await finish(admin, inv.id, { status: "failed", error: "Unknown spike." });
      return { status: "failed" };
    }
    const s = await spikeEvidence(admin, inv.product_id as string, subject);
    rows = s.rows;
    const label = subject.granularity === "day" ? `${s.spike.start.slice(0, 10)} (UTC day)` : `${s.spike.start.slice(0, 13).replace("T", " ")}:00 UTC hour`;
    build = (ev) => spikeExplanationPrompt(product, { periodLabel: label, platform: subject.platform, observed: s.spike.observed, expected: s.spike.expected }, ev);
  } else {
    kind = "cluster_summary";
    const c = await clusterEvidence(admin, (inv.cluster_id ?? inv.subject_key) as string);
    if (!c.cluster) {
      await finish(admin, inv.id, { status: "failed", error: "This issue no longer exists." });
      return { status: "failed" };
    }
    rows = c.rows;
    build = (ev) => clusterSummaryPrompt(product, { category: c.cluster!.category as string, title: c.cluster!.title as string }, ev);
  }

  const sel = selectEvidence(toEvidence(rows));
  if (!sel) {
    await finish(admin, inv.id, {
      status: "insufficient_data",
      report: { reason: `Fewer than ${MIN_EVIDENCE} collected posts about the product are available for this ${kind === "spike_explanation" ? "period" : "issue"}.`, evidence_count: rows.length },
    });
    await emitEvent(admin, inv.workspace_id as string, inv.product_id as string, "ai", { investigation: inv.id });
    return { status: "insufficient_data" };
  }

  const ai = await resolveAi(admin, inv.workspace_id as string);
  if ("ok" in ai) {
    await finish(admin, inv.id, { status: "failed", error: ai.message.slice(0, 500) });
    return { status: "failed" };
  }

  const { system, user } = build(sel.evidence);
  const model = ai.client.modelFor("deep");
  const cacheKey = sha256([kind, PROMPT_VERSION, inv.workspace_id, model, system, user].join("|"));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const evidenceList = [...sel.idMap.values()].map((id) => byId.get(id)!).map((m) => ({
    mention_id: m.id, url: m.source_url, source: m.source, title: m.title, published_at: m.published_at,
  }));

  let output: unknown = (await cacheGet(admin, [cacheKey])).get(cacheKey);
  let cost: number | null = 0;
  if (!output) {
    try {
      const schema = kind === "spike_explanation" ? spikeExplanationSchema : clusterSummarySchema;
      const r = await budgetedCall(admin, ai, { workspaceId: inv.workspace_id as string, productId: inv.product_id as string }, {
        purpose: kind, tier: "deep", system, user, schema: schema as typeof spikeExplanationSchema, schemaName: kind,
        maxTokens: 16_000, mockInput: { evidence: sel.evidence },
      });
      output = r.output;
      cost = r.costMicroUsd;
      await cachePut(admin, inv.workspace_id as string, kind, r.model, [{ key: cacheKey, output }]);
    } catch (e) {
      if (e instanceof AiError && e.retryable) {
        await admin.from("ai_investigations").update({ status: "pending" }).eq("id", inv.id);
        throw e;
      }
      await finish(admin, inv.id, { status: "failed", error: (e instanceof Error ? e.message : "AI analysis failed.").slice(0, 500) });
      return { status: "failed" };
    }
  }

  const o = output as { insufficient_evidence: boolean; summary: string; drivers?: Array<{ statement: string; mention_ids: string[] }>; findings?: Array<{ statement: string; mention_ids: string[]; tier: "reported" | "hypothesis" }>; confidence?: "low" | "medium" | "high" };
  const valid = validateCitedOutput({ insufficient_evidence: o.insufficient_evidence, summary: o.summary, items: o.drivers ?? o.findings ?? [] }, sel.idMap);
  const base = { model: ai.classifier(model), cost_microusd: cost ?? null };
  if (!valid) {
    await finish(admin, inv.id, { ...base, status: "insufficient_data", report: { reason: "The collected posts don't show a clear common cause.", evidence: evidenceList, test_classifier: ai.test } });
  } else {
    const report: InvestigationReport = {
      summary: valid.summary, findings: valid.findings, ...(o.confidence ? { confidence: o.confidence } : {}),
      evidence: evidenceList, dropped_findings: valid.dropped, test_classifier: ai.test, prompt_version: PROMPT_VERSION,
    };
    await finish(admin, inv.id, { ...base, status: "completed", report, error: null });
  }
  await emitEvent(admin, inv.workspace_id as string, inv.product_id as string, "ai", { investigation: inv.id });
  return { status: valid ? "completed" : "insufficient_data" };
}
