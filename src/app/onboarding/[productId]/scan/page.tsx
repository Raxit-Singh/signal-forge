import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/form";
import { advanceOnboardingAction } from "@/app/actions/product";
import { sourceSetup } from "@/lib/server/collection/sources";
import { getLatestScan } from "@/lib/server/collection/status";
import { ScanProgress } from "@/components/scan/scan-progress";
import { AutoRefresh, StartScanButton } from "@/components/scan/scan-controls";
import { StepHeader } from "../../steps";
import { loadOnboardingProduct } from "../load";

export const metadata: Metadata = { title: "First scan" };
// The start-scan action keeps working after responding (see actions/scan.ts).
export const maxDuration = 60;

/** Runs a real initial scan on the sources this server can reach and reports exactly what it found. */
export default async function ScanStep({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await loadOnboardingProduct(productId);
  const setup = sourceSetup();
  const configured = setup.filter((s) => s.configured);
  const unavailable = setup.filter((s) => !s.configured).map((s) => ({ name: s.name, reason: s.reason }));

  const supabase = await createClient();
  const [{ count: keywordCount }, scan] = await Promise.all([
    supabase.from("product_aliases").select("id", { count: "exact", head: true }).eq("product_id", product.id).eq("enabled", true),
    getLatestScan(product.id),
  ]);

  return (
    <>
      <StepHeader
        step={5}
        title="First scan"
        description="Search the available sources for existing conversations about your product."
      />
      <Card>
        <CardContent className="grid gap-4">
          {scan ? (
            <>
              <AutoRefresh active={!scan.done} />
              <ScanProgress scan={scan} unavailable={unavailable} />
            </>
          ) : (
            <div className="grid gap-3">
              <p className="text-[13px]">
                SignalForge will search {configured.map((s) => s.name).join(", ")} for posts from the last 30 days that
                match {product.name}&apos;s {keywordCount ?? 0} active keyword{keywordCount === 1 ? "" : "s"}. Results
                are what the sources actually return — if nothing matches, you&apos;ll see zero, never an estimate.
              </p>
              {unavailable.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Not included: {unavailable.map((u) => `${u.name} (${u.reason ?? "unavailable"})`).join("; ")}
                </p>
              )}
              {(keywordCount ?? 0) === 0 ? (
                <p className="text-[13px] text-negative">
                  Add at least one active keyword first. <Link className="underline" href={`/onboarding/${product.id}/keywords`}>Edit keywords</Link>
                </p>
              ) : (
                <StartScanButton productId={product.id} kind="initial" />
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            {scan?.done && (
              <Button asChild variant="secondary"><Link href="/mentions">View mentions</Link></Button>
            )}
            <form action={advanceOnboardingAction}>
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="step" value="6" />
              <SubmitButton variant={scan?.done ? "default" : "secondary"}>
                {scan && !scan.done ? "Continue — the scan keeps running" : scan ? "Go to dashboard" : "Skip for now"}
              </SubmitButton>
            </form>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
