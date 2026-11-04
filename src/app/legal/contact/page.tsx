import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  const { product, operator, country, email, replyDays } = LEGAL;
  return (
    <article>
      <h1>Contact</h1>
      <p>We reply within {replyDays} business days.</p>

      <p className="!mt-8 text-[22px] font-semibold tracking-[-0.01em]">
        <a href={`mailto:${email}`}>{email}</a>
      </p>
      <p>For help, billing, refunds, privacy requests, or anything else about {product}.</p>

      <h2>Billing and refunds</h2>
      <p>
        Send the email address on your account and the date of the charge. Cancelling needs no email: use Settings → Billing
        → Manage billing. See the <Link href="/legal/refunds">refund policy</Link>.
      </p>

      <h2>Privacy</h2>
      <p>
        To get a copy of your data, correct or delete it, or have a public post of yours removed from {product}, email us.
        See the <Link href="/legal/privacy">privacy policy</Link>.
      </p>

      <h2>Who runs {product}</h2>
      <p>{product} is operated by {operator}, {country}.</p>
    </article>
  );
}
