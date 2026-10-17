import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveProduct, getWorkspacePlan, hasRole, requireWorkspace } from "@/lib/server/session";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ai/action-form";
import { AiSettingsForm } from "@/components/ai/ai-settings-form";
import { deleteAiKeyAction, toggleTestClassifierAction } from "@/app/actions/ai";
import { workspaceAvailability } from "@/lib/server/ai/gateway";
import { mockAllowed } from "@/lib/ai/mock";
import { TEST_CLASSIFIER } from "@/lib/ai/availability";
import { evaluateRelevance, MIN_COMPARISONS, type EvalRow } from "@/lib/ai/evaluation";
import { formatCount } from "@/lib/format";

export const metadata: Metadata = { title: "SignalForge Intelligence" };

const PURPOSE: Record<string, string> = {
  classify: "Classification", embed: "Embeddings (issue grouping)", merge_check: "Issue merge checks",
  spike_explanation: "Spike explanations", cluster_summary: "Issue summaries",
};
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

async function usageThisPeriod(workspaceId: string) {
  const admin = createAdminClient();
  const { data: latest } = await admin.from("ai_usage_records").select("period_start").eq("workspace_id", workspaceId)
    .not("period_start", "is", null).order("period_start", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return null;
  const { data } = await admin.from("ai_usage_records")
    .select("purpose, billed_to, input_tokens, output_tokens, requests, success")
    .eq("workspace_id", workspaceId).eq("period_start", latest.period_start).eq("status", "settled").limit(10_000);
  const by = new Map<string, { requests: number; tokens: number; failed: number }>();
  let billedTokens = 0;
  for (const r of data ?? []) {
    const e = by.get(r.purpose as string) ?? { requests: 0, tokens: 0, failed: 0 };
    const t = Number(r.input_tokens) + Number(r.output_tokens);
    e.requests += Number(r.requests ?? 1);
    e.tokens += t;
    if (!r.success) e.failed++;
    by.set(r.purpose as string, e);
    if (r.billed_to === "signalforge") billedTokens += t;
  }
  return { periodStart: latest.period_start as string, rows: [...by.entries()], billedTokens };
}

export default async function IntelligenceSettings() {
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  const supabase = await createClient();
  const admin = createAdminClient();
  const canManage = hasRole(workspace.role, "admin");
  const head = (q: ReturnType<typeof supabase.from>) => q.select("id", { count: "exact", head: true });

  const [{ data: conns }, { data: settings }, status, { plan }, classified, waiting, failed, evalRes] = await Promise.all([
    supabase.from("ai_provider_connections").select("provider, key_hint, default_model").eq("workspace_id", workspace.id),
    supabase.from("ai_settings").select("auto_classify").eq("workspace_id", workspace.id).maybeSingle(),
    workspaceAvailability(admin, workspace.id),
    getWorkspacePlan(workspace.id),
    product ? head(supabase.from("mentions")).eq("product_id", product.id).eq("processing_status", "classified") : Promise.resolve({ count: 0 }),
    product ? head(supabase.from("mentions")).eq("product_id", product.id).eq("processing_status", "filtered").eq("dedup_kind", "original").in("relevance_status", ["relevant", "pending", "user_relevant"]) : Promise.resolve({ count: 0 }),
    product ? head(supabase.from("mentions")).eq("product_id", product.id).eq("processing_status", "failed") : Promise.resolve({ count: 0 }),
    product ? supabase.from("mentions").select("relevance_status, ai_about_product").eq("product_id", product.id)
      .in("relevance_status", ["user_relevant", "user_irrelevant"]).not("ai_about_product", "is", null).limit(5000) : Promise.resolve({ data: [] }),
  ]);
  const legacyKeys = (conns ?? []).filter((c) => c.provider !== "signalforge");
  const testOn = (conns ?? []).some((c) => c.provider === "signalforge" && c.default_model === TEST_CLASSIFIER);
  const devOnly = mockAllowed({ NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV });
  const usage = canManage ? await usageThisPeriod(workspace.id) : null;
  const allowance = plan.monthlyAiTokenBudget;
  const ev = evaluateRelevance(((evalRes.data ?? []) as Array<{ relevance_status: EvalRow["manual"]; ai_about_product: EvalRow["ai"] }>)
    .map((r) => ({ manual: r.relevance_status, ai: r.ai_about_product })));

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>SignalForge Intelligence</CardTitle>
          <CardDescription>
            SignalForge&apos;s own AI analyses collected mentions: whether each is about your product, sentiment toward it,
            bugs, feature requests, complaints and other feedback, grouped into prioritised issues. It is included in
            your plan — you don&apos;t connect or pay for an AI provider. (Claude for your codebase is separate: see{" "}
            <Link href="/settings/agent" className="underline underline-offset-2">Developer agent</Link>.)
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-[13px]" data-testid="ai-status">
            <span className="font-medium">Status</span>
            {status.ok
              ? <Badge tone={status.kind === "test" ? "warning" : "positive"}>{status.kind === "test" ? "Test classifier (not AI)" : "Active"}</Badge>
              : <Badge tone="neutral">Not running</Badge>}
            <span className="text-muted-foreground">
              {status.ok
                ? status.kind === "test"
                  ? "Labels come from a keyword heuristic for testing. They are marked as test output and are not analysis."
                  : "Classifying new mentions automatically."
                : status.message}
            </span>
          </div>
          {product && (
            <dl className="grid grid-cols-3 gap-3 text-[13px]" data-testid="ai-coverage">
              <div className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">Classified</dt><dd className="text-lg font-semibold tabular">{formatCount(classified.count ?? 0)}</dd></div>
              <div className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">Waiting</dt><dd className="text-lg font-semibold tabular">{formatCount(waiting.count ?? 0)}</dd></div>
              <div className="rounded-md border p-3"><dt className="text-xs text-muted-foreground">Couldn&apos;t classify</dt><dd className="text-lg font-semibold tabular">{formatCount(failed.count ?? 0)}</dd></div>
            </dl>
          )}
          {canManage && <AiSettingsForm workspaceId={workspace.id} autoClassify={settings?.auto_classify ?? true} />}
          {canManage && devOnly && (
            <div className="grid gap-2 rounded-md border border-dashed p-3 text-[13px]">
              <span className="font-medium">Development only: test classifier</span>
              <span className="text-muted-foreground">Exercises classification, grouping and explanations without calling a model. Never available in production.</span>
              <ActionForm action={toggleTestClassifierAction} fields={{ workspaceId: workspace.id, on: testOn ? "false" : "true" }}
                label={testOn ? "Turn off test classifier" : "Use test classifier"} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI relevance check (shadow mode)</CardTitle>
          <CardDescription>
            The AI&apos;s “is this about the product?” answer is only a recommendation. Your team&apos;s decisions and the keyword
            rules decide what counts as a mention, including toward your mention allowance. This compares the AI with
            mentions your team marked relevant or not relevant.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-[13px]" data-testid="relevance-eval">
          {ev.compared === 0 ? (
            <p className="text-muted-foreground">No mentions have both a team decision and an AI answer yet.</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">Precision</dt><dd className="font-semibold tabular">{pct(ev.precision)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Recall</dt><dd className="font-semibold tabular">{pct(ev.recall)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">False positives / negatives</dt><dd className="font-semibold tabular">{ev.falsePositives} / {ev.falseNegatives}</dd></div>
                <div><dt className="text-xs text-muted-foreground">AI unsure</dt><dd className="font-semibold tabular">{ev.uncertain}</dd></div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Based on {ev.compared} mention{ev.compared === 1 ? "" : "s"}.{" "}
                {ev.sufficient
                  ? `With 95% confidence precision is at least ${pct(ev.precisionLower)} and recall at least ${pct(ev.recallLower)}.`
                  : `At least ${MIN_COMPARISONS} decided comparisons are needed before these numbers mean much.`}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>AI allowance</CardTitle>
            <CardDescription>Every model request is reserved against your plan&apos;s monthly AI allowance before it is made and settled with what was actually used.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-[13px]">
            <p data-testid="ai-allowance">
              {allowance > 0
                ? <><span className="font-medium tabular">{formatCount(usage?.billedTokens ?? 0)}</span> of {formatCount(allowance)} tokens used this billing period.</>
                : "Your plan doesn't include SignalForge Intelligence."}
            </p>
            {usage && usage.rows.length > 0 && (
              <table className="w-full" data-testid="ai-usage">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-1 font-medium">Use</th><th className="font-medium">Requests</th><th className="font-medium">Tokens</th></tr>
                </thead>
                <tbody className="tabular">
                  {usage.rows.map(([purpose, u]) => (
                    <tr key={purpose} className="border-t">
                      <td className="py-1.5">{PURPOSE[purpose] ?? purpose}{u.failed > 0 && <span className="text-xs text-muted-foreground"> · {u.failed} failed</span>}</td>
                      <td>{formatCount(u.requests)}</td>
                      <td>{formatCount(u.tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {canManage && legacyKeys.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Saved API keys (no longer used)</CardTitle>
            <CardDescription>
              An earlier version let you add your own AI keys. SignalForge Intelligence no longer uses them; they stay
              encrypted until you remove them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border text-[13px]">
              {legacyKeys.map((k) => (
                <li key={k.provider as string} className="flex flex-wrap items-center gap-2 p-3">
                  <span className="font-medium capitalize">{k.provider as string}</span>
                  {k.key_hint && <span className="font-mono text-xs text-muted-foreground">…{k.key_hint as string}</span>}
                  <ActionForm action={deleteAiKeyAction} fields={{ workspaceId: workspace.id, provider: k.provider as string }} label="Remove" variant="ghost" className="ml-auto" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
