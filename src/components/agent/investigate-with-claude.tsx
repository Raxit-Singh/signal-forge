"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Investigate with Claude": opens a new Claude chat with the issue typed in. Nothing
 * is sent anywhere by SignalForge and nothing comes back; the user continues in Claude.
 * The message is also copied, because the prefilled link isn't a documented Claude feature.
 */
export function InvestigateWithClaude({ message, chatUrl }: { message: string; chatUrl: string | null }) {
  const [note, setNote] = useState<string | null>(null);

  const open = () => {
    // Open first, synchronously in the click, so pop-up blockers allow it.
    window.open(chatUrl ?? "https://claude.ai/new", "_blank", "noopener,noreferrer");
    navigator.clipboard.writeText(message).then(
      () => setNote(chatUrl ? "Opened in Claude. If the message isn't there, paste it: it's copied." : "Opened in Claude. Paste the message (it's copied) and send."),
      () => setNote(chatUrl ? "Opened in Claude." : null),
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
