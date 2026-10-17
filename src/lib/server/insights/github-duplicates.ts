import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server/env";
import { devRoutineAllowed } from "@/lib/server/agent/tasks";
import { site } from "@/lib/server/agent/http";
import { issueSearchQuery, rankMatches, searchTerms, type GithubIssue, type IssueMatch } from "@/lib/insights/insights";

export interface DuplicateReport {
  repo: string;
  query: string;
  words: string[];
  matches: IssueMatch[];
  total: number;
  checked_at: string;
}

type Fetch = typeof fetch;

/** GitHub's API — or, in development only, a local stand-in for the reserved e2e-fixture/* test repositories. */
function apiBase(repo: string): string {
  if (repo.startsWith("e2e-fixture/") && devRoutineAllowed()) return `${site()}/api/dev/mock-github`;
  return "https://api.github.com";
}

/**
 * Searches the product's repository for existing issues that may cover a
 * feedback issue (GitHub issue search, public repositories). Read-only; the
 * result is stored as a "github_duplicates" analysis. No AI is involved.
 */
export async function checkGithubDuplicates(
  admin: SupabaseClient,
  opts: { workspaceId: string; productId: string; clusterId: string; userId: string },
  fetchImpl: Fetch = fetch,
): Promise<{ status: "completed" | "failed"; message?: string }> {
  const [{ data: product }, { data: cluster }] = await Promise.all([
    admin.from("products").select("name, github_repo").eq("id", opts.productId).maybeSingle(),
    admin.from("feedback_clusters").select("id, title, top_terms, area").eq("id", opts.clusterId).eq("product_id", opts.productId).maybeSingle(),
  ]);
  if (!cluster) return { status: "failed", message: "This issue no longer exists." };
  const repo = product?.github_repo as string | null;
  if (!repo) return { status: "failed", message: "Add the product's GitHub repository in product settings first." };

  const { data: members } = await admin.from("feedback_cluster_members").select("mention_id").eq("cluster_id", cluster.id).limit(100);
  const memberIds = (members ?? []).map((m) => m.mention_id as string);
  const { data: posts } = memberIds.length ? await admin.from("mentions").select("title, content").in("id", memberIds) : { data: [] };
  const texts = (posts ?? []).map((p) => `${p.title ?? ""} ${String(p.content ?? "").slice(0, 500)}`);
  const words = searchTerms({ title: cluster.title as string, area: (cluster.area as string | null) ?? null, topTerms: (cluster.top_terms as string[]) ?? [] }, product!.name as string, texts);
  if (!words.length) return { status: "failed", message: "This issue has no distinctive words to search for." };
  const query = issueSearchQuery(repo, words);

  const token = serverEnv().GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "SignalForge" };
  if (token && !repo.startsWith("e2e-fixture/")) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetchImpl(`${apiBase(repo)}/search/issues?${new URLSearchParams({ q: query, per_page: "30" })}`, { headers, signal: AbortSignal.timeout(15_000) });
  } catch {
    return save(admin, opts, cluster.title as string, "failed", null, "Couldn't reach GitHub. Try again in a moment.");
  }
  if (res.status === 422) return save(admin, opts, cluster.title as string, "failed", null, `GitHub can't search ${repo}: it doesn't exist or is private. Only public repositories can be searched.`);
  if (res.status === 403 || res.status === 429) return save(admin, opts, cluster.title as string, "failed", null, "GitHub's search limit was reached. Try again in a minute.");
  if (!res.ok) return save(admin, opts, cluster.title as string, "failed", null, `GitHub search failed (${res.status}).`);

  const body = await res.json() as { total_count?: number; items?: Array<{ number: number; title: string; html_url: string; state: string; updated_at: string; comments: number; pull_request?: unknown }> };
  const issues: GithubIssue[] = (body.items ?? []).filter((i) => !i.pull_request && /^https:\/\/github\.com\//.test(i.html_url))
    .map((i) => ({ number: i.number, title: String(i.title).slice(0, 300), url: i.html_url, state: i.state === "closed" ? "closed" : "open", updatedAt: i.updated_at, comments: Number(i.comments ?? 0) }));
  const report: DuplicateReport = { repo, query, words, matches: rankMatches(issues, words), total: Number(body.total_count ?? issues.length), checked_at: new Date().toISOString() };
  return save(admin, opts, cluster.title as string, "completed", report, null);
}

async function save(
  admin: SupabaseClient, opts: { workspaceId: string; productId: string; clusterId: string; userId: string },
  title: string, status: "completed" | "failed", report: DuplicateReport | null, error: string | null,
): Promise<{ status: "completed" | "failed"; message?: string }> {
  const row = {
    workspace_id: opts.workspaceId, product_id: opts.productId, kind: "github_duplicates", subject_key: opts.clusterId, cluster_id: opts.clusterId,
    title: title.slice(0, 200), status, report, error, requested_by: opts.userId, completed_at: new Date().toISOString(), model: null, cost_microusd: 0,
  };
  // One stored result per issue (the unique index is partial, so no upsert).
  const { data: existing } = await admin.from("ai_investigations").select("id")
    .eq("product_id", opts.productId).eq("kind", "github_duplicates").eq("subject_key", opts.clusterId).maybeSingle();
  const { error: e } = existing
    ? await admin.from("ai_investigations").update(row).eq("id", existing.id)
    : await admin.from("ai_investigations").insert(row);
  if (e) throw new Error(`save duplicate check: ${e.message}`);
  return { status, ...(error ? { message: error } : {}) };
}
