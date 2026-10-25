import Link from "next/link";
import { LogOut } from "lucide-react";
import { Mark } from "@/components/app-shell/sidebar";
import { requireUser } from "@/lib/server/session";
import { signOutAction } from "../(auth)/actions";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden">
      {/* A soft red dawn behind the header; the grain comes from the body. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklab,var(--signal)_13%,transparent),transparent_70%)]" aria-hidden />
      <header className="relative flex items-center justify-between gap-3 px-4 py-4 sm:px-8 sm:py-5">
        <Link href="/overview" aria-label="SignalForge" className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em]">
          <Mark />SignalForge
        </Link>
        <div className="flex min-w-0 items-center gap-3 text-[13px] text-muted-foreground">
          <span className="hidden truncate sm:inline">{user.email}</span>
          <form action={signOutAction}>
            <button className="press panel flex h-9 items-center gap-1.5 rounded-full px-3.5 transition-colors hover:text-foreground">
              <LogOut className="size-3.5" aria-hidden />Sign out
            </button>
          </form>
        </div>
      </header>
      <main id="main" className="relative flex flex-1 justify-center px-4 pb-20 pt-6 sm:pt-12">
        <div className="w-full max-w-[760px]">{children}</div>
      </main>
    </div>
  );
}
