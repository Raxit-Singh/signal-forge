import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasRole, requireWorkspace } from "@/lib/server/session";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { AiProviderPanel } from "@/components/ai-provider-panel";
import { SubmitButton } from "@/components/ui/form";
import { ActionForm } from "@/components/ai/action-form";
import { AiSettingsForm } from "@/components/ai/ai-settings-form";
import { chooseSignalForgeCreditsAction, toggleTestClassifierAction } from "@/app/actions/ai";
import { workspaceAvailability } from "@/lib/server/ai/gateway";
import { mockAllowed } from "@/lib/ai/mock";
import { TEST_CLASSIFIER } from "@/lib/ai/availability";
import { formatUsd } from "@/lib/ai/pricing";
import { formatCount } from "@/lib/format";

export const metadata: Metadata = { title: "AI providers" };

const PURPOSE: Record<string, string> = {
  classify: "Classification", spike_explanation: "Spike explanations", cluster_summary: "Issue summaries",
};

async function usageThisPeriod(workspaceId: string) {
  const admin = createAdminClient();
  const { data: latest } = await admin.from("ai_usage_records").select("period_start").eq("workspace_id", workspaceId)
    .not("period_start", "is", null).order("period_start", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return null;
  const { data } = await admin.from("ai_usage_records")
    .select("purpose, billed_to, input_tokens, output_tokens, cost_microusd, cost_known, success, status")
    .eq("workspace_id", workspaceId).eq("period_start", latest.period_start).eq("status", "settled").limit(10_000);
  const rows = data ?? [];
  const by = new Map<string, { calls: number; tokens: number; cost: number; unknown: boolean; failed: number }>();
  for (const r of rows) {
    const k = r.purpose as string;
    const e = by.get(k) ?? { calls: 0, tokens: 0, cost: 0, unknown: false, failed: 0 };
    e.calls++;
    e.tokens += Number(r.input_tokens) + Number(r.output_tokens);
    e.cost += Number(r.cost_microusd);
    e.unknown ||= !r.cost_known;
    if (!r.success) e.failed++;
    by.set(k, e);
  }
  return { periodStart: latest.period_start as string, rows: [...by.entries()], billedTo: new Set(rows.map((r) => r.billed_to as string)) };
}

export default async function AiSettings() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const [{ data }, { data: settings }] = await Promise.all([
    supabase.from("ai_provider_connections").select("provider, key_hint, status, is_default, default_model, last_error").eq("workspace_id", workspace.id),
    supabase.from("ai_settings").select("auto_classify, byok_monthly_token_cap").eq("workspace_id", workspace.id).maybeSingle(),
  ]);
  const connections = (data ?? []).map((c) => ({
    provider: c.provider as string, keyHint: c.key_hint as string | null, status: c.status as string, isDefault: c.is_default as boolean,
    model: c.default_model as string | null, lastError: c.last_error as string | null,
  }));
  const canManage = hasRole(workspace.role, "admin");
  const usesCredits = connections.some((c) => c.provider === "signalforge");
  const status = await workspaceAvailability(createAdminClient(), workspace.id);
  const usage = canManage ? await usageThisPeriod(workspace.id) : null;
  const testOn = connections.some((c) => c.provider === "signalforge" && c.model === TEST_CLASSIFIER);
  const devOnly = mockAllowed({ NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV });

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>AI providers</CardTitle>
          <CardDescription>
            Used for product-targeted sentiment, feedback categories, an “about the product?” hint, and on-demand
            explanations that cite the posts they rely on. Keys are encrypted at rest, scoped to this workspace, and
            never sent to the browser.
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
                  : status.kind === "byok" ? "Billed by your provider to your own key." : "Billed to SignalForge AI credits included in your plan."
                : status.message}
            </span>
          </div>
          {canManage && !usesCredits && (
            <form action={chooseSignalForgeCreditsAction} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-[13px]">
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <input type="hidden" name="next" value="/settings/ai" />
              <span>Use SignalForge AI credits included in your plan.</span>
              <SubmitButton size="sm" variant="secondary">Use credits</SubmitButton>
            </form>
          )}
          <AiProviderPanel workspaceId={workspace.id} connections={connections} returnTo="/settings/ai" canManage={canManage} />
          {canManage && devOnly && (
            <div className="grid gap-2 rounded-md border border-dashed p-3 text-[13px]">
              <span className="font-medium">Development only: test classifier</span>
              <span className="text-muted-foreground">
                Exercises classification, issues and explanations without calling a model. Never available in production.
              </span>
              <ActionForm action={toggleTestClassifierAction} fields={{ workspaceId: workspace.id, on: testOn ? "false" : "true" }}
                label={testOn ? "Turn off test classifier" : "Use test classifier"} />
            </div>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>AI usage and limits</CardTitle>
            <CardDescription>Every model call is reserved against your limits before it is made and settled with what was actually used.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {usage && usage.rows.length > 0 && (
              <p className="text-xs text-muted-foreground">Billing period starting {usage.periodStart.slice(0, 10)}. Failed calls are included: providers bill the tokens they processed.</p>
            )}
            {usage && usage.rows.length > 0 ? (
              <table className="w-full text-[13px]" data-testid="ai-usage">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-1 font-medium">Use</th><th className="font-medium">Calls</th><th className="font-medium">Tokens</th><th className="font-medium">Est. cost</th></tr>
                </thead>
                <tbody className="tabular">
                  {usage.rows.map(([purpose, u]) => (
                    <tr key={purpose} className="border-t">
                      <td className="py-1.5">{PURPOSE[purpose] ?? purpose}{u.failed > 0 && <span className="text-xs text-muted-foreground"> · {u.failed} failed</span>}</td>
                      <td>{formatCount(u.calls)}</td>
                      <td>{formatCount(u.tokens)}</td>
                      <td>{u.unknown ? "billed by your provider" : formatUsd(u.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[13px] text-muted-foreground">No AI usage in this billing period.</p>
            )}
            <AiSettingsForm workspaceId={workspace.id} autoClassify={settings?.auto_classify ?? true} byokCap={(settings?.byok_monthly_token_cap as number | null) ?? null} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
