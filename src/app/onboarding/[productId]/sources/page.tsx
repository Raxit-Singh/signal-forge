import type { Metadata } from "next";
import { SubmitButton } from "@/components/ui/form";
import { PlatformMark } from "@/components/brand-logo";
import { advanceOnboardingAction } from "@/app/actions/product";
import { sourceSetup } from "@/lib/server/collection/sources";
import { StepHeader } from "../../steps";
import { loadOnboardingProduct } from "../load";

export const metadata: Metadata = { title: "Platforms" };

export default async function SourcesStep({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await loadOnboardingProduct(productId);
  const sources = sourceSetup().filter((x) => x.configured);
  return (
    <>
      <StepHeader step={3} title="Where we listen"
        description={<>SignalForge checks these {sources.length} platforms for {product.name} around the clock. Nothing to connect or configure.</>} />
      <div className="grid gap-6">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Platforms">
          {sources.map((s, i) => (
            <li key={s.id} className="panel lift rise flex items-center gap-2.5 rounded-[18px] p-3 text-[13px] font-medium leading-tight sm:gap-3 sm:p-3.5 sm:text-[14px]"
              style={{ ["--d" as string]: `${120 + Math.min(i, 12) * 35}ms` }}>
              <PlatformMark source={s.id} size={34} />
              <span className="line-clamp-2 min-w-0 break-words">{s.name.replace(/ \/ Stack Exchange$/, "")}</span>
              <span className="breathe ml-auto hidden size-1.5 shrink-0 rounded-full bg-positive sm:block" title="Checked automatically" aria-hidden />
            </li>
          ))}
        </ul>
        <form action={advanceOnboardingAction} className="flex justify-end">
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="step" value="5" />
          <SubmitButton>Continue</SubmitButton>
        </form>
      </div>
    </>
  );
}
