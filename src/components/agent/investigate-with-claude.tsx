"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyLine({ text, label, mono = true }: { text: string; label: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <pre className={`max-h-24 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 text-xs ${mono ? "font-mono" : ""}`} aria-label={label}>{text}</pre>
      <Button type="button" size="sm" variant="secondary" onClick={async () => { if (await copy(text)) { setDone(true); setTimeout(() => setDone(false), 1500); } }}>
        {done ? <Check aria-hidden /> : <Copy aria-hidden />}{done ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/**
 * "Investigate with Claude": hands the issue to the user's own Claude. Nothing is
 * sent anywhere by SignalForge and nothing comes back; the user continues in Claude.
 */
export function InvestigateWithClaude({ message, chatUrl, continueCommand, resumeCommand, connector }: {
  message: string; chatUrl: string | null; continueCommand: string; resumeCommand: string; connector: boolean;
}) {
  const [opened, setOpened] = useState<"typed" | "paste" | null>(null);

  const openChat = async () => {
    await copy(message); // backup: the prefilled link isn't a documented Claude feature
    window.open(chatUrl ?? "https://claude.ai/new", "_blank", "noopener,noreferrer");
    setOpened(chatUrl ? "typed" : "paste");
  };

  return (
    <Dialog onOpenChange={(o) => { if (!o) setOpened(null); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="w-fit" data-testid="investigate-claude"><Sparkles aria-hidden />Investigate with Claude</Button>
      </DialogTrigger>
      <DialogContent title="Investigate with Claude" description="Claude gets the issue and what people wrote, finds the cause in your code and suggests a fix. You continue the conversation in Claude.">
        <div className="grid gap-5 text-[13px]">
          <section className="grid gap-2">
            <h3 className="font-medium">In Claude</h3>
            <p className="text-muted-foreground">A new chat with everything typed in. Uses the GitHub repositories you&apos;ve connected in Claude.</p>
            <Button type="button" size="sm" className="w-fit" onClick={openChat}>Open in Claude <ExternalLink aria-hidden /></Button>
            {opened && (
              <p className="text-xs text-muted-foreground" role="status">
                {opened === "typed" ? "Opened. If the message isn't there, paste it (it's copied)." : "Opened. Paste the message (it's copied) and send."}
              </p>
            )}
          </section>

          <section className="grid gap-2">
            <h3 className="font-medium">In Claude Code, in the chat that already knows your app</h3>
            <p className="text-muted-foreground">Run in your project folder. It continues your most recent Claude Code conversation there and works on your local files.</p>
            <CopyLine label="Continue your last Claude Code chat" text={continueCommand} />
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Pick a different chat</summary>
              <div className="mt-2 grid gap-2">
                <span>1. Run this in your project folder and choose the chat:</span>
                <CopyLine label="Choose a Claude Code chat" text={resumeCommand} />
                <span>2. Paste this message into it:</span>
                <CopyLine label="Message for Claude" text={message} mono={false} />
              </div>
            </details>
          </section>

          {!connector && (
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Optional: <a href="/settings/agent" className="underline underline-offset-2">connect Claude to SignalForge</a> so Claude can read every report on this issue, not only the ones in the message.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
