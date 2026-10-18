"use client";

import * as React from "react";
import { Dialog as D, DropdownMenu as DM, Popover as P } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---- Dropdown menu ---------------------------------------------------------
export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuGroup = DM.Group;

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={sideOffset}
        className={cn("z-50 min-w-48 overflow-hidden rounded-md border bg-surface p-1 shadow-lg", className)}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DM.Item>) {
  return (
    <DM.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none",
        "data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />;
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <DM.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} />;
}

// ---- Popover ---------------------------------------------------------------
export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;

export function PopoverContent({ className, sideOffset = 6, align = "end", ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 w-80 rounded-md border bg-surface shadow-lg outline-none", className)}
        {...props}
      />
    </P.Portal>
  );
}

// ---- Sheet (mobile navigation) -------------------------------------------
export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;

export function SheetContent({ className, children, title, ...props }: React.ComponentProps<typeof D.Content> & { title: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <D.Content
        className={cn("fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r bg-surface shadow-xl outline-none", className)}
        {...props}
      >
        <D.Title className="sr-only">{title}</D.Title>
        <D.Description className="sr-only">{title}</D.Description>
        {children}
        <D.Close className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

// ---- Dialog ----------------------------------------------------------------
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className, children, title, description, ...props
}: React.ComponentProps<typeof D.Content> & { title: string; description?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-surface p-5 shadow-xl outline-none",
          className,
        )}
        {...props}
      >
        <D.Title className="text-base font-semibold">{title}</D.Title>
        {description ? (
          <D.Description className="mt-1 text-[13px] text-muted-foreground">{description}</D.Description>
        ) : (
          <D.Description className="sr-only">{title}</D.Description>
        )}
        <div className="mt-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

// ---- Side panel (details beside the page; full width on phones) --------------
export function SidePanelContent({
  className, children, title, description, ...props
}: React.ComponentProps<typeof D.Content> & { title: string; description?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/30" />
      <D.Content
        className={cn("fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-surface shadow-xl outline-none", className)}
        {...props}
      >
        <div className="border-b p-4 pr-10">
          <D.Title className="text-base font-semibold">{title}</D.Title>
          {description ? <D.Description className="mt-0.5 text-[13px] text-muted-foreground">{description}</D.Description>
            : <D.Description className="sr-only">{title}</D.Description>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        <D.Close className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
