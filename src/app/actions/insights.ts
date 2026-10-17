"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { failure, logServerError, type ActionState } from "@/lib/server/action-result";
import { AuthorizationError, requireWorkspaceRole } from "@/lib/server/session";
import { requestInvestigation, type InvestigationKind } from "@/lib/server/ai/investigate";
import { checkGithubDuplicates } from "@/lib/server/insights/github-duplicates";
import { runWorker } from "@/lib/server/collection/worker";

const FEATURE_CATEGORIES = ["feature_request"];
const DRAFTABLE = ["bug_report", "feature_request", "performance_issue", "usability_complaint", "security_concern", "complaint"];

const payload = z.object({
  workspaceId: z.uuid(),
  clusterId: z.uuid(),
  kind: z.enum(["cluster_summary", "feature_evaluation", "issue_draft"]),
  force: z.enum(["true", "false"]).optional(),
});

const MESSAGES: Record<string, string> = {
  cluster_summary: "Summary requested. It appears here when ready.",
  feature_evaluation: "Evaluation requested. It appears here when ready.",
  issue_draft: "Draft requested. It appears here when ready.",
};

async function loadIssue(workspaceId: string, clusterId: string, minRole: "member" | "viewer" = "member") {
  let userId: string;
  try {
    userId = (await requireWorkspaceRole(workspaceId, minRole)).user.id;
  } catch (e) {
    return { error: failure(e instanceof AuthorizationError ? e.message : "Not allowed.") };
  }
  const admin = createAdminClient();
  const { data: c } = await admin.from("feedback_clusters").select("id, product_id, title, category").eq("id", clusterId).eq("workspace_id", workspaceId).maybeSingle();
  if (!c) return { error: failure("Issue not found.") };
  return { admin, userId, c: c as { id: string; product_id: string; title: string; category: string } };
}

/** On-demand AI analysis of one issue (budgeted, cached; results cite the issue's posts). */
export async function analyzeIssueAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = payload.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  const r0 = await loadIssue(parsed.data.workspaceId, parsed.data.clusterId);
  if ("error" in r0) return r0.error!;
  const { admin, userId, c } = r0;
  const kind = parsed.data.kind as InvestigationKind;
  if (kind === "feature_evaluation" && !FEATURE_CATEGORIES.includes(c.category)) return failure("Only feature requests can be evaluated.");
  if (kind === "issue_draft" && !DRAFTABLE.includes(c.category)) return failure("Drafts are for bugs, feature requests and complaints.");
  try {
    const r = await requestInvestigation(admin, {
      workspaceId: parsed.data.workspaceId, productId: c.product_id, kind, subjectKey: c.id, clusterId: c.id,
      title: c.title, userId, force: parsed.data.force === "true",
    });
    if (r.status === "pending") after(() => runWorker({ budgetMs: 120_000, kinds: ["ai.investigate"] }).then(() => undefined));
    revalidatePath(`/insights/${c.id}`);
    revalidatePath("/insights");
    return { status: "success", message: r.status === "completed" ? "Already done." : MESSAGES[kind]! };
  } catch (e) {
    logServerError("analyzeIssue", e);
    return failure("Couldn't request the analysis.");
  }
}

const dupPayload = z.object({ workspaceId: z.uuid(), clusterId: z.uuid() });

/** Searches the product's public GitHub repository for issues that may already cover this one (read-only). */
export async function checkDuplicatesAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = dupPayload.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Invalid request.");
  const r0 = await loadIssue(parsed.data.workspaceId, parsed.data.clusterId);
  if ("error" in r0) return r0.error!;
  const { admin, userId, c } = r0;
  try {
    const r = await checkGithubDuplicates(admin, { workspaceId: parsed.data.workspaceId, productId: c.product_id, clusterId: c.id, userId });
    revalidatePath(`/insights/${c.id}`);
    return r.status === "completed" ? { status: "success", message: "Checked GitHub." } : failure(r.message ?? "Couldn't check GitHub.");
  } catch (e) {
    logServerError("checkDuplicates", e);
    return failure("Couldn't check GitHub.");
  }
}
