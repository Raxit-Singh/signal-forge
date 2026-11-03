import type { Metadata } from "next";
import { notFound } from "next/navigation";

// The founder's EX mark (v2), redrawn as clean vectors: horizontal and turned upright, with
// letters that follow the theme. Never served in production.
export const metadata: Metadata = { title: "Heardex mark" };

const RED = "#ff3b2f";

// Traced from the v2 drawing (2000px canvas): 88px strokes, letters 580px tall, solid X feet,
// shorter E middle bar, blade from x 274 to 1584.
const LETTERS = [
  "M554 750h88v580h-88z", // E spine
  "M554 997h247v87H554z", // E middle bar
  "M554 750h411l493 492h82v88h-122L927 838H554z", // top arm → diagonal → bottom foot
  "M554 1330h411l493-492h82v-88h-122L927 1242H554z", // bottom arm → diagonal → top foot
];
const BLADE = "M274 1040l78-43h1153l79 43-79 44H352z";
const CX = 929, CY = 1040; // centre of the artwork

/** letters: a colour, or "currentColor" to follow the theme's text colour. */
function Mark({ height, letters, blade = RED, dir }: { height: number; letters: string; blade?: string; dir?: "up" | "down" }) {
  const v = dir !== undefined;
  return (
    <svg viewBox={v ? `${CX - 300} ${CY - 665} 600 1330` : `${CX - 665} ${CY - 300} 1330 600`} height={height} aria-label="Heardex" role="img">
      <g transform={v ? `rotate(${dir === "up" ? -90 : 90} ${CX} ${CY})` : undefined}>
        <path d={BLADE} fill={blade} />
        <g fill={letters}>{LETTERS.map((d) => <path key={d} d={d} />)}</g>
      </g>
    </svg>
  );
}

function Tile({ size, tile, dir }: { size: number; tile: "ink" | "paper" | "red"; dir: "up" | "down" }) {
  const bg = tile === "ink" ? "#0b0b0c" : tile === "paper" ? "#ffffff" : RED;
  return (
    <span className="inline-flex items-center justify-center" aria-hidden
      style={{ width: size, height: size, background: bg, borderRadius: size * 0.24, boxShadow: `inset 0 0 0 1px ${tile === "paper" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.1)"}` }}>
      <Mark height={size * 0.8} dir={dir} letters={tile === "paper" ? "#0b0b0c" : "#f4f4f5"} blade={tile === "red" ? "#0b0b0c" : RED} />
    </span>
  );
}

function Panel({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
      <div className="grid gap-1">
        <h2 className="text-[18px] font-medium">{title}</h2>
        <p className="text-[13px] text-[#8f8f96]">{note}</p>
      </div>
      {children}
    </section>
  );
}

/** One theme sample: the same markup, letters in currentColor, on a dark or light surface. */
function Themed({ dark, children }: { dark: boolean; children: React.ReactNode }) {
  return <div className="grid place-items-center gap-3 rounded-2xl py-7" style={{ background: dark ? "#050506" : "#f6f6f7", color: dark ? "#f4f4f5" : "#0b0b0c" }}>{children}</div>;
}

const Word = () => <span className="text-[22px] font-semibold tracking-[-0.035em]">heardex</span>;

export default function MarkPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main id="main" className="min-h-dvh bg-[#08080a] px-5 py-10 text-[#f4f4f5] sm:px-10">
      <div className="mx-auto grid max-w-[1240px] gap-6">
        <header className="grid gap-2">
          <h1 className="text-[40px] font-medium tracking-[-0.04em]">Your EX mark, v2</h1>
          <p className="max-w-[72ch] text-[14px] text-[#8f8f96]">
            Redrawn from your new version. In the app the letters follow the theme automatically (white on dark, black on light); the blade stays red.
          </p>
        </header>

        <Panel title="Vertical, following the theme" note="The same logo file on both surfaces: only the theme changes. Pointing down (E at the top) and pointing up (E at the bottom).">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Themed dark><Mark height={220} letters="currentColor" dir="down" /></Themed>
            <Themed dark={false}><Mark height={220} letters="currentColor" dir="down" /></Themed>
            <Themed dark><Mark height={220} letters="currentColor" dir="up" /></Themed>
            <Themed dark={false}><Mark height={220} letters="currentColor" dir="up" /></Themed>
          </div>
          <div className="grid grid-cols-2 text-center text-[12px] text-[#8f8f96]"><span>Pointing down</span><span>Pointing up</span></div>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Horizontal, following the theme" note="Beside the name in the sidebar and the site header.">
            <div className="grid gap-3">
              <Themed dark><span className="flex items-center gap-3"><Mark height={24} letters="currentColor" /><Word /></span></Themed>
              <Themed dark={false}><span className="flex items-center gap-3"><Mark height={24} letters="currentColor" /><Word /></span></Themed>
            </div>
          </Panel>
          <Panel title="Stacked, following the theme" note="Vertical mark over the name: sign-in page, landing hero, social banners.">
            <div className="grid grid-cols-2 gap-3">
              <Themed dark><Mark height={96} letters="currentColor" dir="down" /><Word /></Themed>
              <Themed dark={false}><Mark height={96} letters="currentColor" dir="down" /><Word /></Themed>
            </div>
          </Panel>
        </div>

        <Panel title="Icons" note="Browser tab: can follow the browser's theme (Chrome, Firefox, Edge). Phone and saved-app icons can't know the theme, so they use the red tile.">
          <div className="flex flex-wrap items-end gap-8">
            <div className="grid gap-2">
              <span className="text-[12px] text-[#8f8f96]">Browser tab, adapting</span>
              <div className="flex gap-2">
                <span className="flex items-center gap-2 rounded-t-xl bg-[#202124] px-3 py-2 text-[12px] text-[#e8eaed]"><Mark height={16} letters="#f4f4f5" dir="down" />Overview · Heardex</span>
                <span className="flex items-center gap-2 rounded-t-xl bg-[#dee1e6] px-3 py-2 text-[12px] text-[#202124]"><Mark height={16} letters="#0b0b0c" dir="down" />Overview · Heardex</span>
              </div>
            </div>
            {(["down", "up"] as const).map((d) => (
              <div key={d} className="grid gap-2">
                <span className="text-[12px] text-[#8f8f96]">Phone icon · pointing {d}</span>
                <div className="flex items-end gap-4">
                  <span className="grid justify-items-center gap-1.5"><Tile size={64} tile="red" dir={d} /><span className="text-[11px] text-[#c9c9cf]">Red (safe)</span></span>
                  <span className="grid justify-items-center gap-1.5"><Tile size={64} tile="ink" dir={d} /><span className="text-[11px] text-[#c9c9cf]">Black</span></span>
                  <span className="grid justify-items-center gap-1.5"><Tile size={64} tile="paper" dir={d} /><span className="text-[11px] text-[#c9c9cf]">White</span></span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </main>
  );
}
