"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/overlays";
import { setClusterStatusAction } from "@/app/actions/feedback";
import { idle } from "@/lib/action-state";

const ACTIONS = [
  { status: "acknowledged", label: "Acknowledge" },
  { status: "resolved", label: "Mark resolved" },
  { status: "dismissed", label: "Dismiss" },
  { status: "open", label: "Reopen" },
] as const;

/** An issue's triage status in one menu (every change can be undone from the same menu). */
export function StatusMenu({ workspaceId, clusterId, status }: { workspaceId: string; clusterId: string; status: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const set = (next: string) => start(async () => {
    const f = new FormData();
    f.set("workspaceId", workspaceId);
    f.set("clusterId", clusterId);
    f.set("status", next);
    const r = await setClusterStatusAction(idle, f);
    setError(r.status === "error" ? r.message ?? "Couldn't change the status." : null);
  });

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="max-sm:min-h-11" disabled={pending} aria-busy={pending} data-testid="issue-status-menu">
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Status<ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {ACTIONS.filter((a) => a.status !== status).map((a) => (
            <DropdownMenuItem key={a.status} onSelect={() => set(a.status)} className="max-sm:min-h-11">{a.label}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <span className="text-xs text-negative" role="alert">{error}</span>}
    </div>
  );
}
