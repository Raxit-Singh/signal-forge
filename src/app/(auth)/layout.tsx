import Link from "next/link";
import { AuthGlow } from "@/components/landing/auth-glow";
import { switzer } from "@/components/landing/fonts";
import { HeardexMark } from "@/components/landing/hero";
import { DotLogo } from "@/components/landing/dot-logo";
import "@/components/landing/landing.css";

/** Sign-up, sign-in and password pages: dots that gather into the Heardex mark on the left, the form on the right, both in one red light from below. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`hx hx-auth relative grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(480px,38%)] ${switzer.className}`}>
      <Link href="/" className="hx-link absolute left-[var(--margin)] top-7 z-20 flex items-center gap-2.5 text-[20px] font-semibold tracking-[-0.03em]" aria-label="Heardex home">
        <HeardexMark className="h-6 w-6" /><span>heardex</span>
      </Link>
      <AuthGlow />
      <aside className="relative z-10 overflow-hidden max-lg:hidden lg:sticky lg:top-0 lg:h-dvh">
        <DotLogo className="absolute inset-0 z-10" />
      </aside>
      <main id="main" className="relative z-10 flex items-center justify-center px-4 pb-10 pt-24 lg:px-12 lg:py-12">
        <div className="hx-auth-rise w-full max-w-[380px]">{children}</div>
      </main>
    </div>
  );
}
