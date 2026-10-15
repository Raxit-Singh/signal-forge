import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { hasRole, requireWorkspace } from "@/lib/server/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { AiProviderPanel } from "@/components/ai-provider-panel";
import { SubmitButton } from "@/components/ui/form";
import { chooseSignalForgeCreditsAction } from "@/app/actions/ai";

export const metadata: Metadata = { title: "AI providers" };

export default async function AiSettings() {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_provider_connections")
    .select("provider, key_hint, status, is_default")
    .eq("workspace_id", workspace.id);
  const connections = (data ?? []).map((c) => ({
    provider: c.provider as string,
    keyHint: c.key_hint as string | null,
    status: c.status as string,
    isDefault: c.is_default as boolean,
  }));
  const canManage = hasRole(workspace.role, "admin");
  const usesCredits = connections.some((c) => c.provider === "signalforge");

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI providers</CardTitle>
        <CardDescription>
          Used for relevance, sentiment, feedback grouping and investigations (rolling out in a later release). Keys are
          encrypted at rest, scoped to this workspace, and never sent to the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {canManage && !usesCredits && (
          <form action={chooseSignalForgeCreditsAction} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-[13px]">
            <input type="hidden" name="workspaceId" value={workspace.id} />
            <input type="hidden" name="next" value="/settings/ai" />
            <span>Use SignalForge AI credits included in your plan.</span>
            <SubmitButton size="sm" variant="secondary">Use credits</SubmitButton>
          </form>
        )}
        <AiProviderPanel workspaceId={workspace.id} connections={connections} returnTo="/settings/ai" canManage={canManage} />
      </CardContent>
    </Card>
  );
}
