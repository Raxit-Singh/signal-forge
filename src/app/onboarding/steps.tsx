import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const STEPS = ["Product", "Keywords", "Sources", "AI", "First scan"] as const;

/** step is 1-based (1 = Product). */
export function StepHeader({ step, title, description }: { step: number; title: string; description: React.ReactNode }) {
  return (
    <div className="mb-6 grid gap-5">
      <ol className="flex items-center gap-1.5" aria-label="Onboarding progress">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < step;
          const current = n === step;
          return (
            <li key={label} className="flex flex-1 flex-col gap-1.5" aria-current={current ? "step" : undefined}>
              <span className={cn("h-1 rounded-full", done || current ? "bg-primary" : "bg-border")} />
              <span className={cn("hidden items-center gap-1 text-[11px] sm:flex", current ? "font-medium text-foreground" : "text-muted-foreground")}>
                {done && <Check className="size-3" aria-hidden />}
                {label}
                {done && <span className="sr-only">(done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="grid gap-1">
        <p className="text-xs font-medium text-muted-foreground">Step {step} of {STEPS.length}</p>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <div className="text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}
