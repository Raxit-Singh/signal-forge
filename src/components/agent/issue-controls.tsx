import { createAdminClient } from "@/lib/supabase/admin";
import { claudeConnected } from "@/lib/server/agent/tasks";
import { claudeChatUrl, connectorRequest } from "@/lib/agent/investigate";
import { InvestigateWithClaude } from "./investigate-with-claude";

/**
 * "Investigate with Claude" on a feedback issue: a new Claude chat asking Claude to read
 * this issue through the SignalForge connector. Read-only on our side.
 */
export async function AgentIssueControls({ workspaceId, clusterId }: { workspaceId: string; clusterId: string }) {
  const admin = createAdminClient();
  const [{ data: c }, connected] = await Promise.all([
    admin.from("feedback_clusters").select("id, title, product_id").eq("id", clusterId).eq("workspace_id", workspaceId).maybeSingle(),
    claudeConnected(admin, workspaceId),
  ]);
  if (!c) return null;
  const { data: p } = await admin.from("products").select("name").eq("id", c.product_id).maybeSingle();
  const product = (p?.name as string | undefined) ?? "";
  const message = connectorRequest({ id: c.id as string, title: c.title as string, product });
  return (
    <div className="border-t pt-2" data-testid="agent-controls">
      <InvestigateWithClaude connected={connected} message={message} chatUrl={claudeChatUrl(message)} />
    </div>
  );
}
