import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWorkspace } from "@/lib/server/session";
import { isStaff } from "@/lib/server/staff";
import { serverEnv } from "@/lib/server/env";
import { formatCount, formatTime } from "@/lib/format";
import { getTimeZone } from "@/lib/server/timezone";
import { PageHeader } from "@/components/page";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { nameOf } from "@/components/feedback/issue-parts";

// The title is only given to staff, so the page's existence isn't revealed to anyone else.
export async function generateMetadata(): Promise<Metadata> {
  return (await isStaff()) ? { title: "Costs (staff)", robots: { index: false } } : { title: "Page not found", robots: { index: false } };
}
export const dynamic = "force-dynamic";

type Summary = {
  month: string;
  ai: {
    limit_usd: number | null; spent_microusd: number; requests: number; failed: number; reserved_open: number;
    by_purpose: Array<{ purpose: string; micro: number; calls: number; input_tokens: number; output_tokens: number }>;
    by_model: Array<{ model: string; micro: number; calls: number }>;
    daily: Array<{ day: string; micro: number }>;
  };
  api: {
    enabled_limit_usd: number | null; provider_limit_usd: number | null; spent_usd: number; requests: number;
    by_platform: Array<{ platform: string; usd: number; calls: number }>;
    daily: Array<{ day: string; usd: number }>;
  };
  workspaces: Array<{ id: string; name: string; plan: string; ai_micro: number; api_usd: number; mentions_consumed: number | null; mention_allowance: number | null; exhausted_at: string | null }>;
};

const usd = (n: number, digits = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) })}`;
const micro = (n: number) => usd(n / 1e6, n > 0 && n < 10_000 ? 4 : 2);

function Meter({ spent, limit, label }: { spent: number; limit: number | null; label: string }) {
  const share = limit && limit > 0 ? Math.min(1, spent / limit) : null;
  const tone = share === null ? "neutral" : share >= 0.9 ? "negative" : share >= 0.7 ? "warning" : "positive";
  return (
    <div className="grid gap-1.5" data-testid="spend-meter">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-2xl font-semibold tabular">{usd(spent, spent < 1 ? 4 : 2)}</span>
        <span className="text-xs text-muted-foreground">{limit === null ? `${label}: none set, so new spending is blocked` : `of ${usd(limit)} ${label}`}</span>
      </div>
      {share !== null && (
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-muted" aria-hidden>
            <div className="h-2 rounded-full" style={{ width: `${share * 100}%`, background: `var(--${tone === "negative" ? "negative" : tone === "warning" ? "warning" : "positive"})` }} />
          </div>
          <Badge tone={tone}>{Math.round(share * 100)}%</Badge>
        </div>
      )}
    </div>
  );
}

function Table({ head, rows, label }: { head: string[]; rows: Array<Array<React.ReactNode>>; label: string }) {
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">Nothing this month.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]" aria-label={label}>
        <thead className="text-xs text-muted-foreground"><tr>{head.map((h, i) => <th key={h} className={`py-1 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y">{rows.map((r, k) => <tr key={k}>{r.map((c, i) => <td key={i} className={`py-1 ${i ? "text-right tabular" : ""}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default async function CostsPage() {
  const tz = await getTimeZone();
  const at = (d: string | Date) => formatTime(d, tz);
  await requireWorkspace();
  if (!(await isStaff())) notFound(); // not a staff account: this page doesn't exist
  const { data, error } = await createAdminClient().rpc("svc_admin_cost_summary");
  if (error) throw new Error(`cost summary failed (${error.code ?? "db"})`);
  const s = data as Summary;
  const env = serverEnv();
  const aiSpent = s.ai.spent_microusd / 1e6;
  const days = [...new Set([...s.ai.daily.map((d) => d.day), ...s.api.daily.map((d) => d.day)])].sort();
  const aiDay = new Map(s.ai.daily.map((d) => [d.day, d.micro / 1e6]));
  const apiDay = new Map(s.api.daily.map((d) => [d.day, Number(d.usd)]));
  const maxDay = Math.max(0.0001, ...days.map((d) => (aiDay.get(d) ?? 0) + (apiDay.get(d) ?? 0)));

  return (
    <>
      <PageHeader title="Costs" description={<>What SignalForge itself pays this month ({s.month.slice(0, 7)}, UTC). Staff only · read-only · refreshed on every load.</>} />
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>SignalForge Intelligence (Gemini)</CardTitle>
              <CardDescription>
                {env.SIGNALFORGE_AI_ENABLED === "true" ? <>On · {env.SIGNALFORGE_AI_MODEL ?? "no model set"}</> : "Switched off on this server"} ·
                {" "}{formatCount(s.ai.requests)} calls, {formatCount(s.ai.failed)} failed{s.ai.reserved_open ? `, ${s.ai.reserved_open} in flight` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent><Meter spent={aiSpent} limit={s.ai.limit_usd === null ? null : Number(s.ai.limit_usd)} label="monthly limit" /></CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Paid data (API Direct)</CardTitle>
              <CardDescription>{env.PAID_SOURCES_ENABLED === "true" ? "On" : "Switched off on this server"} · {formatCount(s.api.requests)} requests</CardDescription>
            </CardHeader>
            <CardContent>
              <Meter spent={Number(s.api.spent_usd)} limit={s.api.enabled_limit_usd === null ? null : Number(s.api.enabled_limit_usd)} label="global monthly limit" />
              {s.api.provider_limit_usd !== null && <p className="mt-2 text-xs text-muted-foreground">Provider limit: {usd(Number(s.api.provider_limit_usd))}</p>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Daily spend</CardTitle><CardDescription>AI and paid data per day this month.</CardDescription></CardHeader>
          <CardContent>
            {days.length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing spent this month.</p> : (
              <table className="w-full text-[13px]" aria-label="Daily spend">
                <tbody>
                  {days.map((d) => {
                    const a = aiDay.get(d) ?? 0;
                    const p = apiDay.get(d) ?? 0;
                    return (
                      <tr key={d}>
                        <th scope="row" className="w-16 py-0.5 pr-2 text-left font-normal text-muted-foreground">{d.slice(5)}</th>
                        <td className="py-0.5">
                          <div className="flex h-2 gap-px" aria-hidden>
                            <div className="rounded-l-sm bg-[var(--entity-1)]" style={{ width: `${(a / maxDay) * 100}%` }} />
                            <div className="rounded-r-sm bg-[var(--entity-2)]" style={{ width: `${(p / maxDay) * 100}%` }} />
                          </div>
                        </td>
                        <td className="w-40 py-0.5 pl-2 text-right text-xs tabular">AI {usd(a, 4)} · data {usd(p, 2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <ul className="mt-2 flex gap-3 text-xs text-muted-foreground" aria-label="Legend">
              <li className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-[var(--entity-1)]" aria-hidden />AI</li>
              <li className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-[var(--entity-2)]" aria-hidden />Paid data</li>
            </ul>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>AI by purpose</CardTitle></CardHeader>
            <CardContent>
              <Table label="AI spend by purpose" head={["Purpose", "Calls", "Tokens in/out", "Cost"]}
                rows={s.ai.by_purpose.map((p) => [p.purpose.replace(/_/g, " "), formatCount(p.calls), `${formatCount(p.input_tokens)} / ${formatCount(p.output_tokens)}`, micro(p.micro)])} />
              {s.ai.by_model.length > 0 && (
                <div className="mt-3">
                  <Table label="AI spend by model" head={["Model", "Calls", "Cost"]} rows={s.ai.by_model.map((m) => [m.model, formatCount(m.calls), micro(m.micro)])} />
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Paid data by platform</CardTitle></CardHeader>
            <CardContent>
              <Table label="Paid data by platform" head={["Platform", "Requests", "Cost"]} rows={s.api.by_platform.map((p) => [nameOf(p.platform), formatCount(p.calls), usd(Number(p.usd))])} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Workspaces</CardTitle>
            <CardDescription>Spend attributed to each workspace this month and its mention allowance for the current billing period.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table label="Workspaces" head={["Workspace", "Plan", "AI", "Paid data", "Mentions"]}
              rows={s.workspaces.map((w) => [
                w.name, w.plan, micro(Number(w.ai_micro)), usd(Number(w.api_usd)),
                w.mention_allowance ? (
                  <span key="m" className={w.exhausted_at ? "text-negative" : ""}>
                    {formatCount(w.mentions_consumed ?? 0)} / {formatCount(w.mention_allowance)}{w.exhausted_at ? ` · used up ${at(w.exhausted_at)}` : ""}
                  </span>
                ) : "—",
              ])} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
