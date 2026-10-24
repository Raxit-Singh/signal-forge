"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Investigate with Claude": opens a new Claude chat with a short request; Claude reads the
 * issue through the SignalForge connector. Without the connector it leads to connecting it.
 * The request is also copied, because the prefilled link isn't a documented Claude feature.
 */
export function InvestigateWithClaude({ connected, message, chatUrl, primary = false }: { connected: boolean; message: string; chatUrl: string; primary?: boolean }) {
  const [note, setNote] = useState<string | null>(null);
  const variant = primary ? "default" : "secondary";

  if (!connected) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button asChild size="sm" variant={variant} className="w-fit max-sm:min-h-11" data-testid="investigate-claude">
          <Link href="/settings/agent"><Sparkles aria-hidden />Investigate with Claude</Link>
        </Button>
        <Link href="/settings/agent" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">Connect Claude first (one time)</Link>
      </div>
    );
  }

  const open = () => {
    // Open first, synchronously in the click, so pop-up blockers allow it.
    window.open(chatUrl, "_blank", "noopener,noreferrer");
    navigator.clipboard.writeText(message).then(
      () => setNote("Opened in Claude. If the request isn't there, paste it: it's copied."),
      () => setNote("Opened in Claude."),
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant={variant} className="w-fit max-sm:min-h-11" onClick={open} data-testid="investigate-claude">
        <Sparkles aria-hidden />Investigate with Claude
      </Button>
      {note && <span className="text-xs text-muted-foreground" role="status">{note}</span>}
    </div>
  );
}
