import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/form";
import { PlatformIcon } from "@/components/platform-icon";
import { advanceOnboardingAction } from "@/app/actions/product";
import { sourceSetup } from "@/lib/server/collection/sources";
import { StepHeader } from "../../steps";
import { loadOnboardingProduct } from "../load";

export const metadata: Metadata = { title: "Data sources" };

export default async function SourcesStep({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await loadOnboardingProduct(productId);
  const sources = sourceSetup().filter((x) => x.configured);
  return (
    <>
      <StepHeader step={3} title="Data sources" description={<>Where SignalForge listens for {product.name}.</>} />
      <div className="grid gap-4">
        <Card>
          <CardContent>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Platforms">
              {sources.map((s) => (
                <li key={s.id} className="flex items-center gap-2.5 rounded-md border px-3 py-2 text-[13px] font-medium">
                  <PlatformIcon id={s.id} />
                  <span className="min-w-0 truncate">{s.name}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <form action={advanceOnboardingAction} className="flex justify-end">
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="step" value="5" />
          <SubmitButton>Continue</SubmitButton>
        </form>
      </div>
    </>
  );
}
