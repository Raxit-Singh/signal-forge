"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import type { ClaudeState } from "@/lib/agent/connection-state";

/** Claude's own Connectors page (documented: Customize → Connectors). There is no documented link that pre-fills the address. */
export const CLAUDE_CONNECTORS_URL = "https://claude.ai/customize/connectors";

/**
 * Connect Claude: the user adds SignalForge as a connector in Claude and
 * approves access in SignalForge. While the dialog is open (or a connection is
 * pending) the page re-checks the real state; it says Connected only once
 * Claude has actually called SignalForge.
 */
export function ConnectClaude({ address, state, label = "Connect Claude" }: { address: string; state: ClaudeState; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const connected = state === "connected" || state === "needs_attention";

  useEffect(() => {
    if (!(open || state === "connecting") || connected) return;
    const id = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(id);
  }, [open, state, connected, router]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable: the address is selectable */ }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">{label}</Button>
      </DialogTrigger>
      <DialogContent title="Connect Claude" description="Add SignalForge in Claude, then approve. SignalForge never asks for your Claude password.">
        <ol className="grid gap-4 text-[13px]">
          <li className="grid gap-1.5">
            <span className="font-medium">1. Copy SignalForge&apos;s address</span>
            <div className="flex gap-2">
              <input readOnly value={address} aria-label="SignalForge address for Claude" onFocus={(e) => e.currentTarget.select()}
                className="h-8 min-w-0 flex-1 rounded-md border bg-muted/40 px-2 font-mono text-xs" />
              <Button type="button" size="sm" variant="secondary" onClick={copy}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </li>
          <li className="grid gap-1.5">
            <span className="font-medium">2. Add it in Claude</span>
            <span className="text-muted-foreground">Choose <strong className="font-medium text-foreground">Add → Custom connector</strong>, name it SignalForge, paste the address and select Add.</span>
            <Button asChild size="sm" variant="secondary" className="w-fit">
              <a href={CLAUDE_CONNECTORS_URL} target="_blank" rel="noreferrer noopener">Open Claude <ExternalLink aria-hidden /></a>
            </Button>
          </li>
          <li className="grid gap-1">
            <span className="font-medium">3. Approve access</span>
            <span className="text-muted-foreground">Claude opens SignalForge: sign in if asked, choose this workspace and approve. Then come back here.</span>
          </li>
        </ol>
        <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3 text-[13px]" role="status" aria-live="polite">
          {connected ? (
            <span className="flex items-center gap-1.5 text-positive"><CheckCircle2 className="size-4" aria-hidden />Connected</span>
          ) : state === "connecting" ? (
            <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />Approved — waiting for Claude to connect…</span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />Waiting for Claude…</span>
          )}
          <DialogClose asChild><Button size="sm" variant={connected ? "default" : "ghost"}>{connected ? "Done" : "Close"}</Button></DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

