import Link from "next/link";
import { Logo } from "@/components/brand";
import { requireUser } from "@/lib/server/session";
import { signOutAction } from "../(auth)/actions";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-dvh flex-col bg-surface-2">
      <header className="flex items-center justify-between px-6 py-4">
        <Link href="/overview" aria-label="SignalForge"><Logo /></Link>
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
          <span className="hidden sm:inline">{user.email}</span>
          <form action={signOutAction}>
            <button className="hover:text-foreground">Sign out</button>
          </form>
        </div>
      </header>
      <main id="main" className="flex flex-1 justify-center px-4 pb-16 pt-4 sm:pt-10">
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  );
}
