import type { Metadata } from "next";
import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/form";
import { IntegrationList } from "@/components/integration-list";
import { advanceOnboardingAction } from "@/app/actions/product";
import { sourceSetup } from "@/lib/server/collection/sources";
import { StepHeader } from "../../steps";
import { loadOnboardingProduct } from "../load";

export const metadata: Metadata = { title: "Data sources" };

export default async function SourcesStep({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await loadOnboardingProduct(productId);
  const setup = sourceSetup();
  const configured = setup.filter((x) => x.configured).map((x) => x.name);
  const missing = setup.filter((x) => !x.configured).map((x) => x.name);
  return (
    <>
      <StepHeader
        step={3}
        title="Data sources"
        description="Where SignalForge looks for conversations about your product, and exactly what each source can access."
      />
      <div className="grid gap-4">
        <div className="flex gap-2 rounded-md border border-info/30 bg-info/8 p-3 text-[13px]">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
          <p>
            Public sources need nothing from you: SignalForge searches them for{" "}
            <span className="font-medium">{product.name}</span> using your keywords
            {configured.length > 0 && <> ({configured.join(", ")})</>}.
            {missing.length > 0 && <> {missing.join(", ")} {missing.length === 1 ? "isn't" : "aren't"} configured on this server yet.</>}{" "}
            Sources that need your own account (App Store Connect, Google Play, Discord) arrive in a later release and will
            ask for authorization then.
          </p>
        </div>
        <Card><CardContent><IntegrationList /></CardContent></Card>
        <form action={advanceOnboardingAction} className="flex justify-end">
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="step" value="4" />
          <SubmitButton>Continue</SubmitButton>
        </form>
      </div>
    </>
  );
}
