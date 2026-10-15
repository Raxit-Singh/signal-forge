"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Radar, RefreshCw } from "lucide-react";
import { FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { startScanAction } from "@/app/actions/scan";

/** Re-renders the server component every few seconds while work is in progress. */
export function AutoRefresh({ active, intervalMs = 2500 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  return null;
}

export function StartScanButton({
  productId, kind, label, variant = "default", size,
}: {
  productId: string;
  kind: "initial" | "manual";
  label?: string;
  variant?: "default" | "secondary";
  size?: "sm";
}) {
  const [state, action] = useFormAction(startScanAction, idle);
  return (
    <form action={action} className="grid justify-items-start gap-2">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="kind" value={kind} />
      <SubmitButton variant={variant} size={size} pendingLabel="Starting…">
        {kind === "initial" ? <Radar aria-hidden /> : <RefreshCw aria-hidden />}
        {label ?? (kind === "initial" ? "Start scan" : "Scan now")}
      </SubmitButton>
      {state.status === "error" && <FormMessage state={state} />}
    </form>
  );
}
