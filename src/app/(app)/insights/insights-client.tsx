"use client";

import * as React from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/primitives";
import { newIssueUrl } from "@/lib/insights/insights";

/**
 * Editable GitHub issue draft. "Open on GitHub" opens GitHub's own new-issue page
 * prefilled with the edited text; the user submits it there. SignalForge never
 * creates issues or writes to the repository.
 */
export function DraftEditor({ title, body, repo }: { title: string; body: string; repo: string | null }) {
  const [t, setT] = React.useState(title);
  const [b, setB] = React.useState(body);
  const [copied, setCopied] = React.useState(false);
  const id = React.useId();
  let href: string | null = null;
  try {
    href = repo ? newIssueUrl(repo, t, b) : null;
  } catch {
    href = null;
  }
  return (
    <div className="grid gap-2" data-testid="issue-draft">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-t`}>Title</Label>
        <Input id={`${id}-t`} value={t} onChange={(e) => setT(e.target.value)} maxLength={200} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-b`}>Description (Markdown)</Label>
        <Textarea id={`${id}-b`} value={b} onChange={(e) => setB(e.target.value)} rows={14} className="font-mono text-xs" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {href ? (
          <Button asChild size="sm">
            <a href={href} target="_blank" rel="noreferrer noopener">Open on GitHub to file it <ExternalLink aria-hidden /></a>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Add the product&apos;s GitHub repository in product settings to open this draft on GitHub.</span>
        )}
        <Button size="sm" variant="secondary" type="button" onClick={async () => {
          try {
            await navigator.clipboard.writeText(`${t}\n\n${b}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? "Copied" : "Copy draft"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        GitHub opens with this draft filled in; nothing is filed until you submit it there. SignalForge never creates issues in your repository.
      </p>
    </div>
  );
}
