import Link from "next/link";
import { AuthEclipse } from "@/components/landing/backgrounds";
import { switzer } from "@/components/landing/fonts";
import { HeardexMark } from "@/components/landing/hero";
import { FeedClip } from "@/components/landing/product";
import "@/components/landing/landing.css";

/** Sign-up, sign-in and password pages: the product at work on the left, over the landing's eclipse; the form on the right. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`hx hx-auth relative grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(480px,38%)] ${switzer.className}`}>
      <Link href="/" className="hx-link absolute left-[var(--margin)] top-7 z-20 flex items-center gap-2.5 text-[20px] font-semibold tracking-[-0.03em]" aria-label="Heardex home">
        <HeardexMark className="h-6 w-6" /><span>heardex</span>
      </Link>
      <aside className="relative overflow-hidden max-lg:hidden lg:sticky lg:top-0 lg:h-dvh">
        <AuthEclipse className="pointer-events-none absolute inset-0 h-full w-full" />
        <div className="relative z-10 flex h-full flex-col items-center justify-center px-12 pt-16">
          <div className="hx-auth-rise w-full max-w-[540px]">
            <div className="hx-auth-feed"><FeedClip /></div>
            <p className="mt-3 text-center text-[13px] text-[var(--muted)]">Sample posts about a made-up app, sorted as they arrive.</p>
          </div>
        </div>
      </aside>
      <main id="main" className="hx-auth-main flex items-center justify-center px-4 pb-10 pt-24 lg:px-12 lg:py-12">
        <div className="hx-auth-rise w-full max-w-[380px]">{children}</div>
      </main>
    </div>
  );
}
