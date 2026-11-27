"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bug, ImagePlus, X } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/primitives";
import { FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { BUG_MESSAGE_MAX, BUG_SCREENSHOT_MAX_BYTES } from "@/lib/bug-report";
import { reportBugAction } from "@/app/actions/support";
import { cn } from "@/lib/utils";

/** Shrinks a picture to a JPEG small enough for the server-action body limit, or null if it can't be read. */
async function shrink(file: File): Promise<File | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  for (const [width, quality] of [[1600, 0.8], [1280, 0.7], [1000, 0.6], [800, 0.5]] as const) {
    const scale = Math.min(1, width / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (blob && blob.size <= BUG_SCREENSHOT_MAX_BYTES) return new File([blob], "screenshot.jpg", { type: "image/jpeg" });
  }
  return null;
}

function ReportForm({ onDone }: { onDone: () => void }) {
  const pathname = usePathname();
  const [state, action] = useFormAction(reportBugAction, idle);
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  if (state.status === "success") {
    return (
      <div className="grid gap-4">
        <p className="text-[13px] leading-relaxed">{state.message}</p>
        <div><Button size="sm" onClick={onDone}>Close</Button></div>
      </div>
    );
  }

  return (
    <form
      className="grid gap-3"
      action={(fd) => {
        fd.delete("screenshot");
        if (shot) fd.set("screenshot", shot.file);
        return action(fd);
      }}
    >
      <input type="hidden" name="page" value={pathname} />
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-msg`}>What happened?</Label>
        <Textarea id={`${id}-msg`} name="message" rows={5} required minLength={5} maxLength={BUG_MESSAGE_MAX} autoFocus
          defaultValue={state.status === "error" ? state.values?.message : undefined}
          placeholder="What you did, what you expected, and what happened instead." />
      </div>
      <div className="grid gap-1.5">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id={`${id}-shot`}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            setShotError(null);
            if (!f) return;
            const small = await shrink(f);
            if (!small) return setShotError("That picture couldn't be attached. Try a PNG or JPEG screenshot.");
            setShot({ file: small, url: URL.createObjectURL(small) });
          }} />
        {shot ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the user's own file */}
            <img src={shot.url} alt="Screenshot to attach" className="h-14 w-24 rounded-md border object-cover" />
            <Button type="button" size="sm" variant="ghost" onClick={() => setShot(null)}><X aria-hidden /> Remove</Button>
          </div>
        ) : (
          <div>
            <Button type="button" size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              <ImagePlus aria-hidden /> Add a screenshot
            </Button>
          </div>
        )}
        {shotError && <p className="text-xs text-destructive">{shotError}</p>}
        <p className="text-xs text-muted-foreground">We also get the page you&apos;re on and your browser. Replies come to your email.</p>
      </div>
      <FormMessage state={state} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        <SubmitButton size="sm" pendingLabel="Sending…">Send report</SubmitButton>
      </div>
    </form>
  );
}

/** "Report a bug" in the app sidebar: a short form that reaches support by email. */
export function ReportBug({ className, onOpen }: { className?: string; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) onOpen?.(); }}>
      <DialogTrigger asChild>
        <button type="button" data-tour="report-bug"
          className={cn("press flex h-9 w-full items-center gap-3 rounded-xl px-3 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground", className)}>
          <Bug className="size-4" strokeWidth={1.75} aria-hidden />Report a bug
        </button>
      </DialogTrigger>
      <DialogContent title="Report a bug" description="Something broken or confusing? Tell us and we'll look into it.">
        {/* Remounts on each open, so a sent form starts fresh next time. */}
        {open && <ReportForm onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
