import type { Metadata } from "next";
import Link from "next/link";
import { Check, Lightbulb, PackagePlus } from "lucide-react";
import { CountUp } from "@/components/motion";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveProduct, requireWorkspace } from "@/lib/server/session";
import { workspaceAvailability } from "@/lib/server/ai/gateway";
import { categoryLabel } from "@/lib/ai/cluster";
import { STATUS_LABEL as TASK_STATUS } from "@/lib/agent/tasks";
import { formatTime } from "@/lib/format";
import { getTimeZone } from "@/lib/server/timezone";
import { EmptyState, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/primitives";
import { CLUSTER_COLS, PRIORITY_TONE, TREND_LABEL, nameOf, type Cluster } from "@/components/feedback/issue-parts";

export const metadata: Metadata = { title: "Insights" };

const KIND_LABEL: Record<string, string> = {
  cluster_summary: "Summary", feature_evaluation: "Feature evaluation", issue_draft: "GitHub draft",
  github_duplicates: "GitHub check", spike_explanation: "Spike explanation",
};
const RESULT: Record<string, { label: string; tone: "positive" | "neutral" | "negative" | "info" }> = {
  completed: { label: "Ready", tone: "positive" }, insufficient_data: { label: "Insufficient data", tone: "neutral" },
  failed: { label: "Failed", tone: "negative" }, pending: { label: "Working", tone: "info" }, running: { label: "Working", tone: "info" },
};

/** The analyses that apply to an issue, in the order they're usually done. */
const stepsFor = (category: string) =>
  category === "feature_request"
    ? ["cluster_summary", "feature_evaluation", "github_duplicates", "issue_draft"]
    : ["cluster_summary", "github_duplicates", "issue_draft"];

/** Analysed share of open issues as a ring, the count in the middle. */
function Ring({ value, total }: { value: number; total: number }) {
  const c = 2 * Math.PI * 52;
  const share = total > 0 ? value / total : 0;
  return (
    <div className="relative size-[132px] shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r="52" fill="none" stroke="color-mix(in oklab, var(--foreground) 8%, transparent)" strokeWidth="10" />
        {share > 0 && <circle cx="60" cy="60" r="52" fill="none" stroke="var(--foreground)" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${share * c} ${c}`} className="ring-fill" style={{ ["--len" as string]: c, ["--d" as string]: "400ms" }} />}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span className="text-[38px] font-semibold leading-none tracking-[-0.04em]"><CountUp value={value} /></span>
        <span className="mt-1 text-[12px] text-muted-foreground">of {total}</span>
      </div>
    </div>
  );
}

export default async function InsightsPage() {
  const tz = await getTimeZone();
  const at = (d: string | Date) => formatTime(d, tz);
  const { workspace } = await requireWorkspace();
  const product = await getActiveProduct(workspace.id);
  if (!product) {
    return (
      <>
        <PageHeader title="Insights" />
        <EmptyState icon={PackagePlus} title="Add a product first" action={{ href: "/onboarding/product", label: "Add product" }}>
          Insights are built from a product&apos;s feedback.
        </EmptyState>
      </>
    );
  }
  const supabase = await createClient();
  const [ai, clustersRes, invRes, tasksRes] = await Promise.all([
    workspaceAvailability(createAdminClient(), workspace.id),
    supabase.from("feedback_clusters").select(CLUSTER_COLS).eq("product_id", product.id).in("status", ["open", "acknowledged"])
      .order("priority_score", { ascending: false, nullsFirst: false }).order("report_count", { ascending: false }).limit(50),
    supabase.from("ai_investigations").select("id, kind, subject_key, cluster_id, title, status, completed_at, created_at")
      .eq("product_id", product.id).order("created_at", { ascending: false }).limit(200),
    supabase.from("agent_tasks").select("id, stage, status, cluster_id, created_at, pr_url").eq("product_id", product.id).order("created_at", { ascending: false }).limit(20),
  ]);
  const clusters = (clustersRes.data ?? []) as Cluster[];
  const invs = (invRes.data ?? []) as Array<{ id: string; kind: string; subject_key: string | null; cluster_id: string | null; title: string | null; status: string; completed_at: string | null; created_at: string }>;
  const done = new Map<string, Set<string>>();
  for (const i of invs) {
    const key = i.cluster_id ?? i.subject_key;
    if (!key || i.status !== "completed") continue;
    if (!done.has(key)) done.set(key, new Set());
    done.get(key)!.add(i.kind);
  }
  const tasks = (tasksRes.data ?? []) as Array<{ id: string; stage: string; status: keyof typeof TASK_STATUS; cluster_id: string | null; created_at: string; pr_url: string | null }>;
  const titleOf = new Map(clusters.map((c) => [c.id, c.title]));
  const recent = invs.slice(0, 12);

  const counts = Object.fromEntries(Object.keys(KIND_LABEL).map((k) => [k, invs.filter((i) => i.kind === k && i.status === "completed").length]));
  const analysed = clusters.filter((c) => done.has(c.id)).length;
  const issuesWith = (kind: string) => clusters.filter((c) => done.get(c.id)?.has(kind)).length;
  const funnel = [
    { label: "Open issues", value: clusters.length },
    { label: "Summarised", value: issuesWith("cluster_summary") },
    { label: "Checked on GitHub", value: issuesWith("github_duplicates") },
    { label: "Drafted for GitHub", value: issuesWith("issue_draft") },
    { label: "Sent to Claude", value: new Set(tasks.map((t) => t.cluster_id).filter(Boolean)).size },
  ];
  const PRIORITY_INK: Record<string, string> = {
    critical: "var(--signal)", high: "color-mix(in oklab, var(--signal) 55%, var(--foreground) 25%)",
    medium: "color-mix(in oklab, var(--foreground) 55%, transparent)", low: "color-mix(in oklab, var(--foreground) 22%, transparent)",
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 pb-10">
      {/* Hero: how much of the open feedback has been analysed, and what kind of analysis exists. */}
      <section className="grid grid-cols-[minmax(0,1fr)] gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="rise grid content-start gap-5">
          <div className="grid gap-1.5">
            <h1 className="text-[34px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">Insights</h1>
            <p className="max-w-[60ch] text-[14px] text-muted-foreground">Evidence-based analysis of {product.name}&apos;s issues: summaries, feature evaluations, existing GitHub issues and issue drafts, with the posts behind every statement.</p>
          </div>
          <div className="flex items-center gap-5">
            <Ring value={analysed} total={clusters.length} />
            <div className="grid gap-1">
              <span className="text-[15px]">open issue{clusters.length === 1 ? "" : "s"} analysed</span>
              <span className="text-[13px] text-muted-foreground">{clusters.length - analysed} still waiting · analyses run only when you ask</span>
            </div>
          </div>
          <div className={`panel flex w-fit flex-wrap items-center gap-2 rounded-full px-4 py-2 text-[13px] ${ai.ok ? "" : "text-muted-foreground"}`}>
            <span className={`size-2 rounded-full ${ai.ok ? "bg-positive" : "bg-muted-foreground"}`} aria-hidden />
            {ai.ok ? "SignalForge Intelligence on" : <>{ai.message} <Link href="/settings/ai" className="underline underline-offset-2">Details</Link></>}
          </div>
        </div>
        <section className="panel rise grid content-start gap-4 self-end rounded-[18px] p-5" style={{ ["--d" as string]: "120ms" }} aria-label="From feedback to fix">
          <div className="grid gap-1">
            <h2 className="text-[13px] text-muted-foreground">From feedback to fix</h2>
            <p className="text-[12px] text-muted-foreground/80">How far your open issues have got. Each step is done from an issue&apos;s page.</p>
          </div>
          <ol className="grid gap-2.5">
            {funnel.map((f, i) => (
              <li key={f.label} className="grid grid-cols-[8.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-[13px]">
                <span className="truncate text-foreground/85">{f.label}</span>
                <span className="block h-7 overflow-hidden rounded-full bg-foreground/[0.04]" aria-hidden>
                  <span className="grow-x flex h-full items-center rounded-full"
                    style={{ width: `${Math.max(f.value > 0 ? 6 : 0, (f.value / Math.max(1, clusters.length)) * 100)}%`, ["--d" as string]: `${300 + i * 90}ms`,
                      background: i === 0 ? "var(--foreground)" : `color-mix(in oklab, var(--foreground) ${70 - i * 10}%, transparent)` }} />
                </span>
                <span className="text-right text-[15px] font-semibold tabular-nums">{f.value}</span>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-muted-foreground/80">
            {[["cluster_summary", "summary", "summaries"], ["feature_evaluation", "feature evaluation", "feature evaluations"], ["github_duplicates", "GitHub check", "GitHub checks"], ["issue_draft", "draft", "drafts"]]
              .map(([k, one, many]) => `${counts[k!] ?? 0} ${(counts[k!] ?? 0) === 1 ? one : many}`).join(" · ")} ready
          </p>
        </section>
      </section>

      {!ai.ok && (
        <p className="px-1 text-[12px] text-muted-foreground">Analyses need SignalForge Intelligence; GitHub checks and the developer agent work without it.</p>
      )}

      <section className="grid gap-3" aria-labelledby="insight-issues-h">
        <div className="grid gap-1">
          <h2 id="insight-issues-h" className="text-[24px] font-medium tracking-[-0.03em]">Issues to analyse</h2>
          <p className="text-[12px] text-muted-foreground">Open and acknowledged issues by priority. Open one to summarise it, evaluate a request, check GitHub or draft an issue.</p>
        </div>
        {clusters.length === 0 ? (
          <EmptyState icon={Lightbulb} title="No issues yet" action={{ href: "/feedback", label: "Issues" }}>
            Issues appear when at least two people report the same bug, request or complaint.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2" aria-label="Issues" data-testid="insight-issues">
            {clusters.map((c, n) => {
              const kinds = done.get(c.id);
              const hot = c.suggested_priority === "critical" || c.suggested_priority === "high";
              return (
                <li key={c.id} className={`panel lift rise relative grid content-between gap-3 overflow-hidden rounded-[18px] p-5 text-[13px] ${hot ? "border-signal/25" : ""}`}
                  style={{ ["--d" as string]: `${200 + Math.min(n, 10) * 40}ms` }}>
                  {c.suggested_priority && <span className="absolute inset-y-5 left-0 w-[3px] rounded-r-full" style={{ background: PRIORITY_INK[c.suggested_priority], boxShadow: hot ? "var(--signal-glow)" : undefined }} aria-hidden />}
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="info">{categoryLabel(c.category)}</Badge>
                      {c.suggested_priority && <Badge tone={PRIORITY_TONE[c.suggested_priority]}>{c.suggested_priority}</Badge>}
                      {c.priority_evidence && <span className="text-[12px] text-muted-foreground">{TREND_LABEL[c.priority_evidence.observed.trend]}</span>}
                    </div>
                    <Link href={`/insights/${c.id}`} className="text-[16px] font-medium leading-snug tracking-[-0.01em] after:absolute after:inset-0 after:content-[''] hover:underline hover:underline-offset-2">{c.title}</Link>
                    <span className="text-[12px] text-muted-foreground">{c.report_count} reporter{c.report_count === 1 ? "" : "s"}{c.platforms.length > 0 && ` · ${c.platforms.map(nameOf).join(", ")}`}</span>
                  </div>
                  <div className="flex items-center gap-3 border-t border-foreground/[0.06] pt-3">
                    <div className="flex min-w-0 flex-1 items-start" role="group" aria-label="Analyses">
                      {stepsFor(c.category).map((k, i, all) => {
                        const ok = kinds?.has(k) ?? false;
                        return (
                          <div key={k} className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
                            {i < all.length - 1 && <span className={`absolute left-1/2 top-[9px] h-px w-full ${ok && kinds?.has(all[i + 1]!) ? "bg-foreground/50" : "bg-foreground/10"}`} aria-hidden />}
                            <span className={`relative z-10 flex size-[18px] items-center justify-center rounded-full border ${ok ? "border-transparent bg-foreground text-background" : "border-foreground/20 bg-surface"}`}>
                              {ok && <Check className="size-3" strokeWidth={3} aria-hidden />}
                            </span>
                            <span className={`truncate px-1 text-[11px] ${ok ? "text-foreground" : "text-muted-foreground/70"}`}>
                              {KIND_LABEL[k]}<span className="sr-only">{ok ? " done" : " not done"}</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="grid shrink-0 justify-items-end leading-none">
                      <span className={`text-[26px] font-semibold tracking-[-0.03em] tabular-nums ${hot ? "text-signal" : ""}`}>{c.unique_reporters ?? c.report_count}</span>
                      <span className="mt-1 text-[11px] text-muted-foreground">people</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <section className="panel rise grid content-start gap-4 rounded-[18px] p-5" style={{ ["--d" as string]: "300ms" }}>
          <h2 className="text-[13px] text-muted-foreground">Recent analyses</h2>
          {recent.length === 0 ? <p className="text-[13px] text-muted-foreground">None yet.</p> : (
            <ul className="grid" aria-label="Recent analyses">
              {recent.map((i) => {
                const href = i.kind === "spike_explanation" ? "/buzz" : `/insights/${i.cluster_id ?? i.subject_key}`;
                const r = RESULT[i.status] ?? RESULT.pending!;
                return (
                  <li key={i.id} className="relative grid grid-cols-[16px_minmax(0,1fr)] gap-3 pb-4 text-[13px] last:pb-0">
                    <span className="relative flex justify-center" aria-hidden>
                      <span className={`mt-1 size-2.5 rounded-full ${r.tone === "positive" ? "bg-foreground" : r.tone === "negative" ? "bg-signal" : "bg-foreground/30"}`} />
                      <span className="absolute top-4 bottom-[-12px] w-px bg-foreground/10" />
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <Link href={href} className="truncate underline-offset-2 hover:underline">{KIND_LABEL[i.kind] ?? i.kind}: {i.title ?? "Untitled"}</Link>
                      <span className="flex items-center gap-2 text-[11px] text-muted-foreground"><Badge tone={r.tone}>{r.label}</Badge>{at(i.completed_at ?? i.created_at)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="panel rise grid content-start gap-4 rounded-[18px] p-5" style={{ ["--d" as string]: "360ms" }}>
          <div className="grid gap-1">
            <h2 className="text-[13px] text-muted-foreground">Developer agent</h2>
            <p className="text-[12px] text-muted-foreground/80">Investigations your Claude ran in your codebase. <Link href="/settings/agent" className="underline underline-offset-2">Settings</Link></p>
          </div>
          {tasks.length === 0 ? <p className="grid min-h-32 place-content-center rounded-xl border border-dashed px-4 text-center text-[13px] text-muted-foreground">No agent tasks yet. Start one from an issue.</p> : (
            <ul className="grid gap-1.5 text-[13px]" aria-label="Agent tasks">
              {tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-foreground/[0.04]">
                  <Badge tone="neutral">{TASK_STATUS[t.status] ?? t.status}</Badge>
                  {t.cluster_id
                    ? <Link href={`/insights/${t.cluster_id}`} className="min-w-0 truncate underline-offset-2 hover:underline">{t.stage === "investigation" ? "Investigation" : "Implementation"}: {titleOf.get(t.cluster_id) ?? "issue"}</Link>
                    : <span>{t.stage}</span>}
                  {t.pr_url && <a href={t.pr_url} target="_blank" rel="noreferrer" className="text-[12px] underline underline-offset-2">Pull request</a>}
                  <span className="ml-auto text-[11px] text-muted-foreground">{at(t.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
