"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

/** App-wide toasts (Sonner), themed with the app's tokens; bottom-right, out of the work's way. */
export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "!rounded-lg !border !border-border !bg-surface !text-foreground !shadow-lg !text-[13px]",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground",
        },
      }}
    />
  );
}
