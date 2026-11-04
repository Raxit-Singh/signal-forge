import Link from "next/link";
import { formatPrice, intervalPrice, type Plan } from "@/lib/domain/plans";

const QA: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: "What counts as a mention?",
    a: "Each new, unique public post that matches your keywords, or that your team marks relevant. Duplicates, reposts, posts we've already seen, items waiting for review and ones you exclude aren't counted. Marking a counted mention \"Not relevant\" gives it back to this month's allowance.",
  },
  {
    q: "What happens when I use up my mentions for the month?",
    a: "New mentions are held, not thrown away, and paid platforms pause until the allowance renews. Nothing extra is charged and your plan is never upgraded on its own. After an upgrade you can bring the held mentions in.",
  },
  {
    q: "Where does Heardex look?",
    a: "Every plan searches Hacker News, GitHub, Stack Overflow, Bluesky, DEV and app store reviews. Paid plans add Reddit, X, LinkedIn, TikTok, Instagram, Facebook, Substack, news and the wider web.",
  },
  {
    q: "How do keywords and competitors work?",
    a: "One keyword tracks one name: your product, or a competitor. Competitors share your plan's keywords, so on Pro you could track your product and two competitors. Competitor mentions count toward the same monthly allowance.",
  },
  {
    q: "Can I change plan or cancel?",
    a: (
      <>
        Yes, any time from Settings → Billing. A plan change applies straight away and you pay or are credited the difference.
        If you cancel, you keep your plan until the end of what you paid for, then move to Free with your data kept. A first
        payment can be refunded within 14 days: see the <Link href="/legal/refunds" className="hx-faq-link">refund policy</Link>.
      </>
    ),
  },
  {
    q: "Who takes the payment?",
    a: "Dodo Payments, our merchant of record. It charges your card, sends the invoice and handles sales tax, VAT and GST. Heardex never sees your card details.",
  },
  {
    q: "Can I use it from Claude?",
    a: "Yes. Every plan includes the Claude MCP connector, so you can ask Claude about your mentions and issues in plain words.",
  },
];

/** After pricing: the questions people ask before they pay. Native details/summary, so it works without script. */
export function Faq({ plans }: { plans: Plan[] }) {
  // The yearly answer comes from the plans table, like the prices above it.
  const yearly = plans.filter((p) => p.priceCentsYearly && p.priceCentsMonthly > 0).map((p) => {
    const off = p.priceCentsMonthly - intervalPrice(p, "year").perMonthCents;
    return `${formatPrice(off, p.currency)} a month less on ${p.name}`;
  });
  const items = yearly.length ? [...QA.slice(0, 4), {
    q: "Is yearly billing worth it?",
    a: `Yearly costs ${yearly.length > 1 ? `${yearly.slice(0, -1).join(", ")} and ${yearly.at(-1)}` : yearly[0]}, paid once for the year. You get the same limits, and your mentions still renew every month.`,
  }, ...QA.slice(4)] : QA;
  return (
    <section id="faq" className="hx-frame mx-auto max-w-[1560px] pb-[clamp(96px,14vh,160px)]" aria-labelledby="faq-title">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-10">
        <div>
          <h2 id="faq-title" className="text-[clamp(36px,5vw,80px)] font-semibold leading-[0.98] tracking-[-0.045em]">Questions, answered.</h2>
          <p className="mt-5 max-w-[34ch] text-[length:var(--step-lead)] leading-snug text-[var(--muted)]">
            Something else? Write to <Link href="/legal/contact" className="hx-faq-link">our support</Link>.
          </p>
        </div>
        <div className="border-t border-[var(--line)]">
          {items.map(({ q, a }) => (
            <details key={q} className="hx-faq">
              <summary>
                <span>{q}</span>
                <svg viewBox="0 0 16 16" aria-hidden><path d="M8 3v10M3 8h10" /></svg>
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
