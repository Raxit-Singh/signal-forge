// Photographs the Docs screenshots drawn in src/components/marketing/doc-screens.tsx (sample data) and writes them
// to public/docs/app-*.webp at twice their layout size, so they stay sharp on high-density screens. Prints where each
// data-spot element sits, in percent of the picture, for the walkthrough pointers in src/content/docs.tsx.
//
// Needs the dev server on http://localhost:3000 (the page is development-only):  node scripts/docs-shots.mjs [shot ...]
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.SHOTS_URL ?? "http://localhost:3000";
const SHOTS = { overview: [1440, 950], mentions: [1440, 830], trends: [1440, 950], competitors: [1440, 800], monitoring: [1440, 950], claude: [1440, 700], keywords: [912, 410] };
const only = process.argv.slice(2);

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, colorScheme: "dark" });
// Essential cookies only, so the cookie banner stays out of the pictures.
await ctx.addCookies([{ name: "hx_consent", value: "essential", url: BASE }]);
const spots = {};
for (const [name, [w, h]] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(name)) continue;
  const page = await ctx.newPage();
  await page.setViewportSize({ width: w, height: h });
  const res = await page.goto(`${BASE}/prototypes/docs-shots/${name}`, { waitUntil: "networkidle" });
  if (!res?.ok()) throw new Error(`${name}: HTTP ${res?.status()}`);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "nextjs-portal, [data-nextjs-toast] { display: none !important; }" });
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
  await sharp(png).webp({ quality: 86 }).toFile(`public/docs/app-${name}.webp`);
  spots[name] = await page.evaluate(([W, H]) => Object.fromEntries([...document.querySelectorAll("[data-spot]")].map((el) => {
    const r = el.getBoundingClientRect();
    return [el.getAttribute("data-spot"), [+(((r.left + r.width / 2) / W) * 100).toFixed(1), +(((r.top + r.height / 2) / H) * 100).toFixed(1)]];
  })), [w, h]);
  await page.close();
  console.log(`public/docs/app-${name}.webp  ${w}×${h} @2x`);
}
await browser.close();
console.log(JSON.stringify(spots, null, 1));
