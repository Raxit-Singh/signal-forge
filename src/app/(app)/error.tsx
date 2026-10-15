"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center" role="alert">
      <AlertTriangle className="size-6 text-negative" aria-hidden />
      <h2 className="text-[15px] font-semibold">Something went wrong loading this page</h2>
      <p className="max-w-md text-[13px] text-muted-foreground">
        Your data is safe. Try again — if it keeps happening, share the reference below with support.
      </p>
      {error.digest && <code className="rounded bg-muted px-2 py-0.5 text-xs">ref {error.digest}</code>}
      <Button variant="secondary" onClick={reset}>Try again</Button>
    </Card>
  );
}
