import Link from "next/link";
import { formatPrice, type Plan } from "@/lib/domain/plans";

const n = (v: number) => v.toLocaleString("en-US");
const s = (v: number, word: string) => `${n(v)} ${word}${v === 1 ? "" : "s"}`;

/** What each plan gives, in plain words, from its row in the plans table (prices and limits are never set here). */
function lines(p: Plan) {
  const years = p.historyDays / 365;
  return [
    p.maxCompetitorsPerProduct > 0 ? "Competitor monitoring" : null,
    p.monitoringIntervalMinutes <= 60 ? "Smart monitoring engine" : p.monitoringIntervalMinutes >= 1440 ? "Checked once a day" : `Checked every ${Math.round(p.monitoringIntervalMinutes / 60)} hours`,
    Number.isInteger(years) ? `${s(years, "year")} of history` : `${n(p.historyDays)} days of history`,
    p.features.daily_reports ? "Daily and weekly reports" : p.features.weekly_reports ? "Weekly reports" : null,
    p.features.feedback_intelligence ? "AI sorting into ranked issues" : null,
    "Claude MCP support", // the connector (src/app/api/mcp) is open to every plan
  ].filter((l): l is string => Boolean(l));
}

/** After the story: the plans, side by side. The one that tracks competitors is lit. */
export function Pricing({ plans, start }: { plans: Plan[]; start: { href: string; label: string } }) {
  if (!plans.length) return null;
  const lit = plans.find((p) => p.maxCompetitorsPerProduct > 0 && p.priceCentsMonthly > 0)?.id;
  return (
    <section id="pricing" className="hx-frame relative mx-auto max-w-[1560px] py-[clamp(96px,14vh,160px)]" aria-labelledby="pricing-title">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-end lg:gap-10">
        <h2 id="pricing-title" className="text-[clamp(36px,5vw,80px)] font-semibold leading-[0.98] tracking-[-0.045em]">Pay for what you hear.</h2>
        <p className="max-w-[52ch] text-[length:var(--step-lead)] leading-snug text-[var(--muted)] lg:justify-self-end">
          Plans differ in how many keywords we search for and how many mentions a month we bring you. One keyword tracks one name: your product or a competitor.
        </p>
      </div>

      <ol className="mt-14 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => (
          <li key={p.id} className={`hx-plan${p.id === lit ? " is-lit" : ""}`}>
            <h3 className="text-[17px] font-medium">{p.name}</h3>
            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="text-[52px] font-semibold leading-none tracking-[-0.045em] tabular-nums">{p.priceCentsMonthly === 0 ? "$0" : formatPrice(p.priceCentsMonthly, p.currency)}</span>
              <span className="text-[15px] text-[var(--muted)]">a month</span>
            </p>
            <div className="mt-7 grid grid-cols-2 gap-2">
              <p className="hx-plan-stat"><b>{n(p.maxKeywords)}</b>keyword{p.maxKeywords === 1 ? "" : "s"}</p>
              <p className="hx-plan-stat"><b>{n(p.monthlyMentionLimit)}</b>mentions a month</p>
            </div>
            <ul className="mb-8 mt-6 grid gap-2.5 text-[15px]">
              {lines(p).map((l) => (
                <li key={l} className="flex gap-2.5"><svg viewBox="0 0 16 16" className="hx-plan-tick" aria-hidden><path d="m3.5 8.5 3 3 6-7" /></svg>{l}</li>
              ))}
            </ul>
            <Link href={start.href} className={`hx-nav mt-auto justify-center${p.id === lit ? " is-primary" : " is-quiet"}`}>
              {p.priceCentsMonthly === 0 ? start.label : `Choose ${p.name}`}
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-[14px] text-[var(--muted)]">Prices in US dollars.</p>
    </section>
  );
}
