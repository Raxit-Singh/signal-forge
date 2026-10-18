"use client";

import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlays";
import { FormMessage, SubmitButton, useFormAction } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { setScanningAction } from "@/app/actions/monitoring";

/** Stop scan (with confirmation) / Resume scanning for one product. */
export function StopScan({ productId, productName, stopped }: { productId: string; productName: string; stopped: boolean }) {
  const [state, action] = useFormAction(setScanningAction, idle);
  // The dialog stays open until this submission's result arrives (a new state object).
  const [openedAt, setOpenedAt] = useState<typeof state | null>(null);
  const open = openedAt === state;
  const setOpen = (o: boolean) => setOpenedAt(o ? state : null);

  if (stopped) {
    return (
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="stop" value="false" />
        <SubmitButton size="sm" pendingLabel="Resuming…"><Play aria-hidden />Resume scanning</SubmitButton>
        <FormMessage state={state} />
      </form>
    );
  }
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Pause aria-hidden />Stop scan</Button>
      <FormMessage state={state} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Stop scanning ${productName}?`} description="No platform will be searched for this product or its competitors until you resume. A running historical search ends; everything collected so far is kept.">
          <form action={action} className="flex justify-end gap-2">
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="stop" value="true" />
            <DialogClose asChild><Button type="button" variant="ghost" size="sm">Cancel</Button></DialogClose>
            <SubmitButton size="sm" variant="destructive" pendingLabel="Stopping…">Stop scan</SubmitButton>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
