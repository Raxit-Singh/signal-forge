"use client";

import { DropdownMenu as DM } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterOption { value: string; label: string; group?: string }

/**
 * A pill that opens a themed list (instead of the browser's native select popup).
 * `label` names the control for assistive tech ("Platform"); the pill shows the current choice.
 */
export function FilterSelect({ label, value, options, onChange, className }: {
  label: string; value: string; options: FilterOption[]; onChange: (value: string) => void; className?: string;
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  const active = value !== (options[0]?.value ?? "");
  return (
    <DM.Root>
      <DM.Trigger aria-label={`${label}: ${current?.label}`}
        className={cn("press panel group flex h-9 max-w-full items-center gap-1.5 rounded-full pl-3.5 pr-2.5 text-[13px] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:border-foreground/25",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground", className)}>
        {active && <span className="size-1.5 shrink-0 rounded-full bg-foreground" aria-hidden />}
        <span className="truncate">{current?.label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60 transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="start" sideOffset={8} collisionPadding={12}
          className="menu-surface z-50 max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto rounded-2xl border bg-surface/95 p-1.5 shadow-[0_24px_48px_-16px_rgba(0,0,0,0.55)] backdrop-blur-md">
          <DM.Label className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">{label}</DM.Label>
          <DM.RadioGroup value={value} onValueChange={onChange}>
            {options.map((o, i) => (
              <div key={o.value}>
              {o.group && o.group !== options[i - 1]?.group && (
                <DM.Label className="px-2.5 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">{o.group}</DM.Label>
              )}
              <DM.RadioItem value={o.value}
                className="flex cursor-default select-none items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] outline-none transition-colors data-[highlighted]:bg-foreground/[0.07] data-[state=checked]:text-foreground data-[state=unchecked]:text-foreground/80">
                <span className="flex-1 truncate">{o.label}</span>
                <DM.ItemIndicator><Check className="size-3.5 text-signal" aria-hidden /></DM.ItemIndicator>
              </DM.RadioItem>
              </div>
            ))}
          </DM.RadioGroup>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
