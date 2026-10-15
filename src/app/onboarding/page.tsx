import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActiveWorkspace, getProducts } from "@/lib/server/session";
import { Card, CardContent } from "@/components/ui/primitives";
import { CreateWorkspaceForm } from "./workspace-form";

export const metadata: Metadata = { title: "Set up your workspace" };

const ROUTE_FOR_STEP: Record<number, string> = { 2: "keywords", 3: "sources", 4: "ai", 5: "scan" };

/** Entry point: create a workspace, or resume onboarding where the user left off. */
export default async function OnboardingIndex() {
  const workspace = await getActiveWorkspace();
  if (workspace) {
    const products = await getProducts(workspace.id);
    const unfinished = products.find((p) => p.onboardingStep < 6);
    if (unfinished) redirect(`/onboarding/${unfinished.id}/${ROUTE_FOR_STEP[unfinished.onboardingStep] ?? "keywords"}`);
    if (products.length === 0) redirect("/onboarding/product");
    redirect("/overview");
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Create your workspace</h1>
        <p className="text-muted-foreground">
          A workspace holds your products, data sources and billing. You can invite teammates later.
        </p>
      </div>
      <Card>
        <CardContent>
          <CreateWorkspaceForm />
        </CardContent>
      </Card>
    </div>
  );
}
