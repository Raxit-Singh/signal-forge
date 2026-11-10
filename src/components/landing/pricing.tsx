"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import NumberFlow from "@number-flow/react";
import { formatPrice, intervalPrice, type BillingInterval, type Plan } from "@/lib/domain/plans";

const n = (v: number) => v.toLocaleString("en-US");
const s = (v: number, word: string) => `${n(v)} ${word}${v === 1 ? "" : "s"}`;
const usd = (cents: number, currency: string) => formatPrice(cents, currency);

/** What each plan gives, in plain words, from its row in the plans table (prices and limits are never set here). */
function lines(p: Plan) {
  const years = p.historyDays / 365;
  return [
    p.maxCompetitorsPerProduct > 0 ? "Competitor monitoring" : null,
    p.monitoringIntervalMinutes <= 60 ? "Smart monitoring engine" : p.monitoringIntervalMinutes >= 1440 ? "Checked once a day" : `Checked every ${Math.round(p.monitoringIntervalMinutes / 60)} hours`,
    Number.isInteger(years) ? `${s(years, "year")} of history` : `${n(p.historyDays)} days of history`,
    p.features.daily_reports ? "Daily and weekly reports" : p.features.weekly_reports ? "Weekly reports" : null,
    p.features.feedback_intelligence ? "AI sorting into ranked issues" : null,
    "MCP support", // the connector (src/app/api/mcp) is open to every plan
  ].filter((l): l is string => Boolean(l));
}

/** After the story: the plans, side by side, monthly or yearly. The one that tracks competitors is lit. */
export function Pricing({ plans, start }: { plans: Plan[]; start: { href: string; label: string } }) {
  const [interval, setBilling] = useState<BillingInterval>("month");
  const grid = useRef<HTMLOListElement>(null);
  const frame = useRef(0);
  if (!plans.length) return null;
  const lit = plans.find((p) => p.maxCompetitorsPerProduct > 0 && p.priceCentsMonthly > 0)?.id;
  const currency = plans[0]!.currency;
  const bestSave = Math.max(0, ...plans.map((p) => intervalPrice(p, "year").saveCents));
  const yearly = interval === "year";

  // The cards' borders light up around the pointer: each card gets the pointer's position in its own box.
  const track = (e: React.PointerEvent) => {
    const { clientX: x, clientY: y } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      for (const card of grid.current?.children ?? []) {
        const r = card.getBoundingClientRect();
        (card as HTMLElement).style.setProperty("--mx", `${x - r.left}px`);
        (card as HTMLElement).style.setProperty("--my", `${y - r.top}px`);
      }
    });
  };

  return (
    <section id="pricing" className="hx-frame relative mx-auto max-w-[1560px] py-[clamp(96px,14vh,160px)]" aria-labelledby="pricing-title">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-end lg:gap-10">
        <h2 id="pricing-title" className="text-[clamp(36px,5vw,80px)] font-semibold leading-[0.98] tracking-[-0.045em]">Pay for what you hear.</h2>
        <p className="max-w-[52ch] text-[length:var(--step-lead)] leading-snug text-[var(--muted)] lg:justify-self-end">
          Plans differ in how many keywords we search for and how many mentions a month we bring you. One keyword tracks one name: your product or a competitor.
        </p>
      </div>

      <div className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="hx-switch" role="group" aria-label="Billing" data-interval={interval}>
          <span className="hx-switch-pill" aria-hidden />
          <button type="button" aria-pressed={!yearly} onClick={() => setBilling("month")}>Monthly</button>
          <button type="button" aria-pressed={yearly} onClick={() => setBilling("year")}>Yearly</button>
        </div>
        {bestSave > 0 && (
          <p className={`hx-save${yearly ? " is-on" : ""}`}>
            {yearly ? `Yearly billing on: you save up to ${usd(bestSave, currency)} a year` : `Save up to ${usd(bestSave, currency)} a year with yearly billing`}
          </p>
        )}
      </div>

      <ol ref={grid} onPointerMove={track} className="hx-plans mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => {
          const free = p.priceCentsMonthly === 0;
          const price = intervalPrice(p, interval);
          const offPerMonth = p.priceCentsYearly ? p.priceCentsMonthly - Math.round(p.priceCentsYearly / 12) : 0;
          return (
            <li key={p.id} className={`hx-plan${p.id === lit ? " is-lit" : ""}`}>
              <span className="hx-plan-glow" aria-hidden />
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[17px] font-medium">{p.name}</h3>
                {!free && offPerMonth > 0 && (
                  <span className={`hx-plan-off${yearly ? " is-on" : ""}`}>{yearly ? `${usd(offPerMonth, p.currency)} off a month` : `${usd(offPerMonth, p.currency)} a month less yearly`}</span>
                )}
              </div>
              <p className="mt-5 flex items-baseline gap-1.5">
                <span className="text-[52px] font-semibold leading-none tracking-[-0.045em] tabular-nums">
                  {free ? "$0" : (
                    <NumberFlow locales="en-US" value={price.perMonthCents / 100} format={{ style: "currency", currency: p.currency.toUpperCase(), maximumFractionDigits: 0 }} />
                  )}
                </span>
                <span className="text-[15px] text-[var(--muted)]">a month</span>
                {yearly && price.saveCents > 0 && (
                  <s className="ml-1 text-[17px] text-[var(--muted)] decoration-[var(--red)]">{usd(p.priceCentsMonthly, p.currency)}</s>
                )}
              </p>
              <p className="mt-2 min-h-[22px] text-[14px] text-[var(--muted)]">
                {free ? "Free, no card needed"
                  : yearly && p.priceCentsYearly ? <>{usd(p.priceCentsYearly, p.currency)} billed yearly · <span className="text-[var(--ink)]">you save {usd(price.saveCents, p.currency)}</span></>
                  : "Billed monthly"}
              </p>
              <div className="mt-6 grid grid-cols-2 gap-2">
                <p className="hx-plan-stat"><b>{n(p.maxKeywords)}</b>keyword{p.maxKeywords === 1 ? "" : "s"}</p>
                <p className="hx-plan-stat"><b>{n(p.monthlyMentionLimit)}</b>mentions a month</p>
              </div>
              <ul className="mb-8 mt-6 grid gap-2.5 text-[15px]">
                {lines(p).map((l) => (
                  <li key={l} className="flex gap-2.5"><svg viewBox="0 0 16 16" className="hx-plan-tick" aria-hidden><path d="m3.5 8.5 3 3 6-7" /></svg>{l}</li>
                ))}
              </ul>
              <Link href={start.href} className={`hx-nav hx-rise mt-auto justify-center${p.id === lit ? " is-primary" : " is-quiet"}`}>
                {free ? start.label : `Choose ${p.name}`}
              </Link>
            </li>
          );
        })}
      </ol>
      <p className="mt-6 text-[14px] text-[var(--muted)]">Prices in US dollars, plus any sales tax shown at checkout. Mention allowances renew every month on both monthly and yearly billing.</p>
    </section>
  );
}
