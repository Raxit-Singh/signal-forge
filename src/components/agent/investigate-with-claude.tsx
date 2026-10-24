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
export function InvestigateWithClaude({ connected, message, chatUrl }: { connected: boolean; message: string; chatUrl: string }) {
  const [note, setNote] = useState<string | null>(null);

  if (!connected) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="secondary" className="w-fit" data-testid="investigate-claude">
          <Link href="/settings/agent"><Sparkles aria-hidden />Investigate with Claude</Link>
        </Button>
        <span className="text-xs text-muted-foreground">Connect SignalForge to Claude first (one time).</span>
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
      <Button type="button" size="sm" variant="secondary" className="w-fit" onClick={open} data-testid="investigate-claude">
        <Sparkles aria-hidden />Investigate with Claude
      </Button>
      {note && <span className="text-xs text-muted-foreground" role="status">{note}</span>}
    </div>
  );
}
