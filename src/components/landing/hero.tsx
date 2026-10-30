import Link from "next/link";
import { PlatformMark } from "@/components/brand-logo";

/** --i: order around the pinwheel, clockwise from the top-left; --x/--y: the tile's direction out from the centre. */
const tile = (i: number, x: number, y: number) => ({ ["--i" as string]: i, ["--x" as string]: x, ["--y" as string]: y });

/** The Heardex mark: six tiles fitted edge to edge. `animated` assembles it tile by tile, on a loop. */
export function HeardexMark({ className, animated = false }: { className?: string; animated?: boolean }) {
  return (
    <svg viewBox="423 403 1085 1126" className={`${animated ? "hx-mark" : ""} ${className ?? ""}`} fill="currentColor" aria-hidden>
      <path style={tile(0, -1, -1)} d="M423 589a186 186 0 0 1 372 0v309a45 45 0 0 1-45 45H468a45 45 0 0 1-45-45z" />
      <rect style={tile(1, 0, -1)} x="818" y="564" width="294" height="382" rx="45" />
      <path style={tile(2, 1, -1)} d="M1137 575a371 371 0 0 1 371 371h-371z" />
      <path style={tile(5, -1, 1)} d="M423 985h372v372A372 372 0 0 1 423 985z" />
      <rect style={tile(4, 0, 1)} x="818" y="985" width="287" height="382" rx="45" />
      <path style={tile(3, 1, 1)} d="M1182 989h281a45 45 0 0 1 45 45v309a186 186 0 0 1-372 0v-309a45 45 0 0 1 46-45z" />
    </svg>
  );
}

// Sample posts about a made-up notes app, so the board reads at full density; never a customer.
const FEED = [
  { source: "reddit", where: "r/productivity", when: "2m", text: "Export to PDF crashes every time my note is longer than 40 pages." },
  { source: "app_store", where: "App Store · 2★", when: "9m", text: "Lost an hour of work when export froze the app." },
  { source: "hackernews", where: "Hacker News", when: "24m", text: "Search is instant, but the PDF export still falls over on big docs." },
  { source: "github", where: "nimbus/desktop #412", when: "1h", text: "Sync stalls at 99% after the 1.8 update." },
];

const RANKED = [
  { kind: "Bug", tone: "bg-[var(--red)]", title: "PDF export crashes on long notes", people: 38 },
  { kind: "Request", tone: "bg-[#2a78d6]", title: "Offline mode on mobile", people: 21 },
  { kind: "Competitor", tone: "bg-[#eda100]", title: "“Switched to Inkwell for sync”", people: 9 },
];

export function Hero({ signedIn, start, platforms }: {
  signedIn: boolean;
  start: { href: string; label: string };
  platforms: number;
}) {
  return (
    <section className="hx-board grid min-h-[100svh] grid-rows-[56px_1fr] gap-2 p-2 md:h-[100svh] md:min-h-[640px]" aria-label="Heardex">
      {/* The top row is tiles too: the mark, the links, the action. */}
      <div className="grid grid-cols-[56px_1fr_auto] gap-2 md:grid-cols-[56px_minmax(0,1fr)_180px]">
        <Link href="/" className="hx-tile grid place-items-center bg-[var(--paper)] text-[var(--paper-ink)]" aria-label="Heardex home">
          <HeardexMark className="h-7 w-7" />
        </Link>
        <nav aria-label="Main" className="hx-tile flex items-center gap-7 bg-[var(--field-1)] px-5 text-[15px] whitespace-nowrap lg:pl-[calc(50vw-90px)] md:justify-end lg:justify-start">
          <span className="mr-auto font-semibold tracking-[-0.03em] text-[var(--ink)] md:hidden">heardex</span>
          <a href="#product" className="hx-link hidden text-[var(--muted)] md:inline">Product</a>
          <a href="#pricing" className="hx-link hidden text-[var(--muted)] md:inline">Pricing</a>
          <a href="#faq" className="hx-link hidden text-[var(--muted)] md:inline">FAQ</a>
          {!signedIn && <Link href="/login" className="hx-link text-[var(--muted)]">Sign in</Link>}
        </nav>
        <Link href={start.href} className="hx-tile hx-press flex items-center px-5 text-[15px] font-medium bg-[var(--paper)] text-[var(--paper-ink)]">
          {start.label}
        </Link>
      </div>

      {/* The board: two by two, the bottom-right split in two. */}
      <div className="grid gap-2 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:grid-rows-[1.2fr_1fr]">
        <div className="hx-tile hx-in flex min-h-[46svh] flex-col justify-end bg-[var(--paper)] p-6 text-[var(--paper-ink)] md:min-h-0 md:p-8">
          <h1 className="text-[clamp(44px,5vw,96px)] font-semibold leading-[0.95] tracking-[-0.045em]">
            Hear what people say <br className="max-md:hidden" />about your product.
          </h1>
          <p className="mt-8 max-w-[44ch] text-[length:var(--step-body)] leading-normal">
            Heardex finds every post about your product on Reddit, Hacker News, GitHub, the app stores and more.
          </p>
        </div>

        {/* What it hears: the mentions feed as the dashboard shows it. */}
        <div data-ui className="hx-tile hx-in flex flex-col overflow-hidden bg-[var(--field-1)] p-5 [--d:80ms] md:p-6">
          <div className="flex items-center justify-between text-[14px] text-[var(--muted)]">
            <span className="font-medium text-[var(--ink)]">Mentions of Nimbus</span>
            <span className="flex items-center gap-2"><span className="hx-pip hx-live" aria-hidden />Live</span>
          </div>
          <ul className="mt-4 grid gap-2">
            {FEED.map((p, i) => (
              <li key={i} className="flex gap-3 rounded-[6px] bg-[var(--field-2)] p-3.5">
                <PlatformMark source={p.source} size={30} />
                <div className="min-w-0 flex-1">
                  <p className="flex gap-2 text-[13px] text-[var(--muted)]"><span className="truncate">{p.where}</span><span className="ml-auto tabular-nums">{p.when}</span></p>
                  <p className="mt-0.5 text-[15px] leading-snug text-[var(--ink)]">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* What it makes of it: the same posts, ranked. */}
        <div data-ui className="hx-tile hx-in flex flex-col bg-[var(--field-1)] p-5 [--d:160ms] max-md:order-last md:p-6">
          <div className="flex items-center justify-between text-[14px] text-[var(--muted)]">
            <span className="font-medium text-[var(--ink)]">Fix first</span>
            <span>This week</span>
          </div>
          <ol className="mt-4 grid flex-1 content-start gap-2">
            {RANKED.map((r) => (
              <li key={r.title} className="flex items-center gap-4 rounded-[6px] bg-[var(--field-2)] px-4 py-3.5">
                <span className={`h-9 w-1 shrink-0 rounded-full ${r.tone}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-[var(--muted)]">{r.kind}</p>
                  <p className="truncate text-[17px] font-medium text-[var(--ink)]">{r.title}</p>
                </div>
                <p className="shrink-0 text-right text-[13px] text-[var(--muted)]"><span className="block text-[22px] font-semibold tabular-nums text-[var(--ink)]">{r.people}</span>people</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <p className="hx-tile hx-in bg-[var(--field-2)] p-5 text-[length:var(--step-lead)] font-medium leading-tight tracking-[-0.02em] [--d:240ms] max-md:aspect-square md:p-6">
            {platforms} places, read every few minutes. Sorted into bugs, requests and complaints.
          </p>
          <Link href={start.href} className="hx-tile hx-in hx-press flex flex-col justify-between bg-[var(--red-deep)] p-5 text-white [--d:320ms] max-md:aspect-square md:p-6">
            <span className="text-[length:var(--step-lead)] font-medium leading-tight tracking-[-0.02em]">Then we tell you what to fix first.</span>
            <span className="text-[15px] font-medium">{start.label} →</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
