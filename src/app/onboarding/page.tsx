import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { History, Package, Radar, Tags } from "lucide-react";
import { getActiveWorkspace, getProducts } from "@/lib/server/session";
import { Card, CardContent } from "@/components/ui/primitives";
import { CreateWorkspaceForm } from "./workspace-form";

export const metadata: Metadata = { title: "Set up your workspace" };

const ROUTE_FOR_STEP: Record<number, string> = { 2: "keywords", 3: "sources", 4: "scan", 5: "scan" };

const AHEAD = [
  { icon: Package, title: "Your product", text: "Name and website" },
  { icon: Tags, title: "Keywords", text: "What people call it" },
  { icon: Radar, title: "Platforms", text: "Where we listen" },
  { icon: History, title: "History", text: "How far back to look" },
];

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
    <div className="grid gap-7">
      <div className="rise grid gap-2">
        <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground/80">Welcome</p>
        <h1 className="text-[32px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[44px]">Create your workspace</h1>
        <p className="max-w-[58ch] text-[14px] text-muted-foreground">
          A workspace holds your products, data sources and billing. You can invite teammates later. Setup takes about two minutes.
        </p>
      </div>
      <Card className="rise" style={{ ["--d" as string]: "80ms" }}>
        <CardContent>
          <CreateWorkspaceForm />
        </CardContent>
      </Card>
      <section aria-label="What comes next" className="grid gap-3">
        <h2 className="text-[13px] text-muted-foreground">Next, four short steps</h2>
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {AHEAD.map((a, i) => (
            <li key={a.title} className="panel rise grid gap-3 rounded-[18px] p-4" style={{ ["--d" as string]: `${160 + i * 60}ms` }}>
              <span className="flex items-center justify-between">
                <span className="flex size-8 items-center justify-center rounded-full border bg-foreground/[0.04]"><a.icon className="size-4" aria-hidden /></span>
                <span className="text-[12px] tabular-nums text-muted-foreground/70">0{i + 1}</span>
              </span>
              <span className="grid gap-0.5">
                <span className="text-[14px] font-medium">{a.title}</span>
                <span className="text-[12px] text-muted-foreground">{a.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
