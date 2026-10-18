import Link from "next/link";
import { Logo } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-2">
      <header className="px-6 py-5">
        <Link href="/" aria-label="SignalForge home">
          <Logo />
        </Link>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:pt-12">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm sm:p-8">{children}</div>
      </main>
    </div>
  );
}
