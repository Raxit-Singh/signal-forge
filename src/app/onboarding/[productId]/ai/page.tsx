import type { Metadata } from "next";
import { Bot, Sparkles } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/form";
import { advanceOnboardingAction } from "@/app/actions/product";
import { StepHeader } from "../../steps";
import { loadOnboardingProduct } from "../load";

export const metadata: Metadata = { title: "AI analysis" };

export default async function AiStep({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const product = await loadOnboardingProduct(productId);

  return (
    <>
      <StepHeader
        step={4}
        title="AI analysis"
        description="Nothing to set up here: SignalForge Intelligence is part of SignalForge."
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Sparkles className="size-4 text-primary" aria-hidden />SignalForge Intelligence</CardTitle>
            <CardDescription>
              Collected mentions are analysed automatically: whether each is really about {product.name}, sentiment toward
              it, bug reports, feature requests and complaints, grouped into prioritised issues with the posts behind them.
              It runs on SignalForge&apos;s own AI and uses your plan&apos;s AI allowance; you never need an AI key.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Bot className="size-4 text-primary" aria-hidden />Claude developer agent (optional, later)</CardTitle>
            <CardDescription>
              Developers can later connect their own Claude account and GitHub repository in Settings → Developer agent, so
              Claude can investigate an issue in your codebase and, after your approval, open a pull request. That runs on
              your Claude subscription, not on SignalForge.
            </CardDescription>
          </CardHeader>
        </Card>
        <form action={advanceOnboardingAction} className="flex justify-end gap-2">
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="step" value="5" />
          <SubmitButton>Continue</SubmitButton>
        </form>
      </div>
    </>
  );
}
