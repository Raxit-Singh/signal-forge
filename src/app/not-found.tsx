import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-mono text-xs text-muted-foreground">404</p>
      <h1 className="text-lg font-semibold">This page doesn&apos;t exist, or you don&apos;t have access to it.</h1>
      <Button asChild variant="secondary"><Link href="/overview">Back to SignalForge</Link></Button>
    </main>
  );
}
