import { createAdminClient } from "@/lib/supabase/admin";
import { issueContext } from "@/lib/server/agent/tasks";
import { chatHandoff, continueCommand, investigationMessage, RESUME_COMMAND } from "@/lib/agent/investigate";
import { InvestigateWithClaude } from "./investigate-with-claude";

/**
 * "Investigate with Claude" on a feedback issue: the issue and its strongest reports,
 * ready for the user's own Claude (web, desktop or Claude Code). Read-only on our side.
 */
export async function AgentIssueControls({ workspaceId, clusterId }: { workspaceId: string; clusterId: string }) {
  const admin = createAdminClient();
  const [ic, { count: grants }] = await Promise.all([
    issueContext(admin, workspaceId, clusterId),
    admin.from("oauth_grants").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("revoked_at", null),
  ]);
  if (!ic) return null;
  const chat = chatHandoff(ic.context);
  return (
    <div className="border-t pt-2" data-testid="agent-controls">
      <InvestigateWithClaude
        message={chat.message} chatUrl={chat.url}
        continueCommand={continueCommand(investigationMessage(ic.context))} resumeCommand={RESUME_COMMAND}
        connector={(grants ?? 0) > 0}
      />
    </div>
  );
}
