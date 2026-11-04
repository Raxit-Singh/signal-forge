import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  const { product, operator, country, email } = LEGAL;
  return (
    <article>
      <h1>Terms of Service</h1>
      <p>Last updated {LEGAL.updated}</p>

      <p>
        These terms are an agreement between you and {operator}, who operates {product} from {country} (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;). By creating an account or using {product} you accept them. If you use {product} for a company,
        you accept them on its behalf and confirm you may do so.
      </p>

      <h2>1. What {product} is</h2>
      <p>
        {product} is a web application for software teams. It searches public sources such as Hacker News, GitHub, Stack
        Overflow, Reddit, X, app store reviews and other sites for the product and competitor names you choose, stores the
        public mentions it finds, and uses AI to sort them into bugs, feature requests, complaints and praise. You use it in
        your browser; nothing is shipped to you.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must be at least 18 and give a real email address.</li>
        <li>Keep your login safe. You are responsible for what happens in your account and workspaces.</li>
        <li>Workspace owners decide who is a member and what they can see.</li>
        <li>Tell us at <a href={`mailto:${email}`}>{email}</a> if you think someone else is using your account.</li>
      </ul>

      <h2>3. Plans and payment</h2>
      <ul>
        <li>There is a free plan and paid plans, billed monthly or yearly. Each plan&rsquo;s prices, keyword limit and monthly mention allowance are shown on the <Link href="/#pricing">pricing section</Link> and on your billing page.</li>
        <li>
          Payments are processed by <strong>Dodo Payments</strong>, our merchant of record. Dodo Payments sells the
          subscription to you, charges your card, issues your invoice and handles sales tax, VAT or GST. Its own terms also
          apply to the payment.
        </li>
        <li>Paid plans renew at the end of each month or year, depending on the billing you chose, until you cancel. Yearly billing is paid up front for the year; the mention allowance still renews every month. Prices are in US dollars, plus any tax shown at checkout.</li>
        <li>If you move to a different paid plan or billing interval, the change takes effect at once and the difference for the rest of the period is charged or credited.</li>
        <li>If a renewal payment fails, your workspace goes back to free-plan limits until the payment is made. Your data is kept.</li>
        <li>We may change prices. A new price applies from your next renewal after we tell you by email at least 14 days ahead.</li>
      </ul>

      <h2>4. Cancelling</h2>
      <p>
        You can cancel at any time from Settings → Billing → Manage billing. Your plan stays active until the end of the
        month or year you have paid for, then your workspace moves to the free plan. Refunds are covered by
        our <Link href="/legal/refunds">refund policy</Link>.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use {product} to harass, track or build profiles of private individuals;</li>
        <li>break the law, or the terms of the sources {product} searches, through your use of it;</li>
        <li>resell or share access to {product}, or use it to build a competing service;</li>
        <li>probe, overload or get around the limits and security of {product};</li>
        <li>upload anything you have no right to share.</li>
      </ul>
      <p>We may suspend an account that breaks these rules, and will tell you why unless the law prevents it.</p>

      <h2>6. Your data and public content</h2>
      <p>
        The names, keywords, settings and notes you add are yours. You give us permission to store and process them only
        to run {product} for you. Mentions {product} collects are public posts written by other people; they remain theirs,
        and you should use them in line with the source&rsquo;s terms and applicable law. How we handle personal data is set
        out in our <Link href="/legal/privacy">privacy policy</Link>.
      </p>

      <h2>7. AI results</h2>
      <p>
        {product} uses AI models to classify and summarise mentions. The results can be wrong or incomplete. Check anything
        important against the original mention, which {product} always links to.
      </p>

      <h2>8. Availability and changes</h2>
      <p>
        We work to keep {product} running, but it is provided &ldquo;as is&rdquo;, without a guarantee that it will always be
        available or that every mention will be found. Public sources can change or stop working without notice. We may
        change or remove features; if a change takes away something you pay for, you can cancel and ask for a refund of the
        unused part of the period you paid for.
      </p>

      <h2>9. Liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect or consequential loss, lost profits or lost data, and
        our total liability for any claim is limited to the amount you paid us in the 12 months before it. Nothing in these
        terms limits liability that cannot be limited by law.
      </p>

      <h2>10. Ending the agreement</h2>
      <p>
        You can stop using {product} and delete your account at any time from Settings → Account. Deleting it removes your
        workspaces and their data. We may end the agreement if you seriously or repeatedly break these terms.
      </p>

      <h2>11. Law</h2>
      <p>
        These terms are governed by the laws of {country}. If a dispute cannot be settled by talking to us first, the courts
        of {country} have jurisdiction, without taking away any rights you have under the consumer law of where you live.
      </p>

      <h2>12. Changes to these terms</h2>
      <p>We may update these terms. If a change matters, we will email account owners before it takes effect.</p>

      <h2>Contact</h2>
      <p>Questions about these terms: <a href={`mailto:${email}`}>{email}</a>.</p>
    </article>
  );
}
