import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/form";
import { advanceOnboardingAction } from "@/app/actions/product";
import { sourceSetup } from "@/lib/server/collection/sources";
import { getBackfillStatus } from "@/lib/server/collection/backfill-status";
import { loadHistoryFormProps } from "@/lib/server/history-form";
import { getWorkspaceUsage } from "@/lib/server/session";
import { HistoryForm } from "@/components/history/history-form";
import { BackfillProgress } from "@/components/history/backfill-progress";
import { LiveIndicator, RealtimeProvider } from "@/components/realtime/realtime-provider";
import { StepHeader } from "../../steps";
import { loadOnboardingProduct } from "../load";

export const metadata: Metadata = { title: "Historical search" };
// The start action keeps working after responding (see actions/history.ts).
export const maxDuration = 60;

/** Asks how far back to search, then shows real per-platform progress of the historical search. */
export default async function HistoryStep({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await loadOnboardingProduct(productId);
  const setup = sourceSetup();
  const configured = setup.filter((s) => s.configured);
  const unavailable = setup.filter((s) => !s.configured);

  const supabase = await createClient();
  const [{ count: keywordCount }, run, usage] = await Promise.all([
    supabase.from("product_aliases").select("id", { count: "exact", head: true }).eq("product_id", product.id).eq("enabled", true),
    getBackfillStatus(product.id),
    getWorkspaceUsage(product.workspace_id),
  ]);
  const running = run && ["queued", "searching"].includes(run.status);

  return (
    <RealtimeProvider workspaceId={product.workspace_id} productId={product.id}>
      <StepHeader
        step={5}
        title="Historical search"
        description="Choose how far back to look for existing conversations about your product."
      />
      <Card>
        <CardContent className="grid gap-4">
          {run ? (
            <>
              <div className="flex justify-end"><LiveIndicator /></div>
              <BackfillProgress status={run} allowanceRemaining={usage?.mentionsRemaining ?? null} renewsOn={usage ? usage.periodEnd.slice(0, 10) : null} />
            </>
          ) : (keywordCount ?? 0) === 0 ? (
            <p className="text-[13px] text-negative">
              Add at least one active keyword first. <Link className="underline" href={`/onboarding/${product.id}/keywords`}>Edit keywords</Link>
            </p>
          ) : (
            <>
              <p className="text-[13px] text-muted-foreground">
                Searches {configured.map((s) => s.name).join(", ")} for {product.name}&apos;s {keywordCount} active keyword{keywordCount === 1 ? "" : "s"}.
                Results are what the sources actually return — if nothing matches, you&apos;ll see zero, never an estimate.
              </p>
              {unavailable.length > 0 && (
                <p className="text-xs text-muted-foreground">Not included: {unavailable.map((u) => `${u.name} (${u.reason ?? "unavailable"})`).join("; ")}</p>
              )}
              <HistoryForm {...await loadHistoryFormProps(product.id)} />
            </>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            {run && (
              <Button asChild variant="secondary"><Link href="/mentions">View mentions</Link></Button>
            )}
            <form action={advanceOnboardingAction}>
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="step" value="6" />
              <SubmitButton variant={run ? "default" : "secondary"}>
                {running ? "Continue — the search keeps running" : run ? "Go to dashboard" : "Skip for now"}
              </SubmitButton>
            </form>
          </div>
        </CardContent>
      </Card>
    </RealtimeProvider>
  );
}
