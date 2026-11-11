import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Refund and Cancellation Policy" };

export default function RefundsPage() {
  const { product, email, refundDays, replyDays } = LEGAL;
  return (
    <article>
      <h1>Refund and Cancellation Policy</h1>
      <p>Last updated {LEGAL.updated}</p>

      <p>
        {product} has a free plan so you can try it before paying. Paid plans are monthly or yearly subscriptions sold through Dodo
        Payments, our merchant of record.
      </p>

      <h2>Cancelling</h2>
      <ul>
        <li>Cancel any time in Settings → Billing → Manage billing. No email or call needed.</li>
        <li>Your plan stays active until the end of the month or year you have paid for. You won&rsquo;t be charged again.</li>
        <li>After that your workspace moves to the free plan. Your data is kept.</li>
      </ul>

      <h2>Refunds</h2>
      <ul>
        <li><strong>First payment:</strong> if {product} isn&rsquo;t right for you, ask within {refundDays} days of your first payment for a new subscription and we will refund it in full.</li>
        <li><strong>Charged by mistake:</strong> a duplicate charge, a charge after you cancelled, or any other billing error is always refunded in full.</li>
        <li><strong>Service problems:</strong> if {product} was unavailable or didn&rsquo;t work for a large part of a month, we will refund that month&rsquo;s share of what you paid.</li>
        <li><strong>Plan changes:</strong> moving to a cheaper paid plan or from yearly to monthly billing credits the unused difference automatically; no request is needed.</li>
        <li>Otherwise, renewals that have already started are not refunded. You can cancel so the next one doesn&rsquo;t happen.</li>
        <li><strong>Closed for abuse:</strong> an account we close for breaking the <Link href="/legal/terms">terms</Link> (section 6), for example for fraud or misusing refunds, is not refunded.</li>
      </ul>

      <h2>How to ask for a refund</h2>
      <p>
        Email <a href={`mailto:${email}`}>{email}</a> from the address on your account, with the date of the charge. We reply
        within {replyDays} business days. Approved refunds are made by Dodo Payments to the card or account you paid with, and
        usually arrive within 5 to 10 business days, depending on your bank.
      </p>

      <h2>Your rights</h2>
      <p>This policy doesn&rsquo;t take away any refund rights you have under the consumer law where you live.</p>
    </article>
  );
}
