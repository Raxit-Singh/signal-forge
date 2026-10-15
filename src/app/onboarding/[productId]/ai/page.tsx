import type { Metadata } from "next";
import { Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/form";
import { AiProviderPanel } from "@/components/ai-provider-panel";
import { advanceOnboardingAction } from "@/app/actions/product";
import { chooseSignalForgeCreditsAction } from "@/app/actions/ai";
import { StepHeader } from "../../steps";
import { loadOnboardingProduct } from "../load";

export const metadata: Metadata = { title: "AI provider" };

export default async function AiStep({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await loadOnboardingProduct(productId);
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_provider_connections")
    .select("provider, key_hint, status, is_default")
    .eq("workspace_id", product.workspace_id);
  const connections = (data ?? []).map((c) => ({
    provider: c.provider as string,
    keyHint: c.key_hint as string | null,
    status: c.status as string,
    isDefault: c.is_default as boolean,
  }));

  return (
    <>
      <StepHeader
        step={4}
        title="AI analysis"
        description="AI classifies sentiment, groups feedback and explains spikes. Choose who pays for it — you can change this any time."
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Sparkles className="size-4 text-primary" aria-hidden />SignalForge AI credits</CardTitle>
            <CardDescription>
              Included in paid plans, with a monthly budget per plan. AI features arrive in a later release; nothing is
              charged or processed yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={chooseSignalForgeCreditsAction}>
              <input type="hidden" name="workspaceId" value={product.workspace_id} />
              <input type="hidden" name="next" value={`/onboarding/${product.id}/scan`} />
              <SubmitButton variant="secondary">Use SignalForge credits</SubmitButton>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Or use your own key</CardTitle>
            <CardDescription>Anthropic, OpenAI or Gemini. Usage is billed by the provider to you.</CardDescription>
          </CardHeader>
          <CardContent>
            <AiProviderPanel
              workspaceId={product.workspace_id}
              connections={connections}
              returnTo={`/onboarding/${product.id}/ai`}
              canManage
            />
          </CardContent>
        </Card>

        <form action={advanceOnboardingAction} className="flex justify-end gap-2">
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="step" value="5" />
          <SubmitButton variant={connections.length ? "default" : "ghost"}>
            {connections.length ? "Continue" : "Skip for now"}
          </SubmitButton>
        </form>
      </div>
    </>
  );
}
