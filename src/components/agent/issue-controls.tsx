import { createAdminClient } from "@/lib/supabase/admin";
import { issueContext } from "@/lib/server/agent/tasks";
import { chatHandoff } from "@/lib/agent/investigate";
import { InvestigateWithClaude } from "./investigate-with-claude";

/**
 * "Investigate with Claude" on a feedback issue: a new Claude chat with the issue and
 * its strongest reports typed in. Read-only on our side.
 */
export async function AgentIssueControls({ workspaceId, clusterId }: { workspaceId: string; clusterId: string }) {
  const ic = await issueContext(createAdminClient(), workspaceId, clusterId);
  if (!ic) return null;
  const chat = chatHandoff(ic.context);
  return (
    <div className="border-t pt-2" data-testid="agent-controls">
      <InvestigateWithClaude message={chat.message} chatUrl={chat.url} />
    </div>
  );
}
