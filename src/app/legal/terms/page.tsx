import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  const { product, operator, country, email } = LEGAL;
  const mail = <a href={`mailto:${email}`}>{email}</a>;
  return (
    <article>
      <h1>Terms of Service</h1>
      <p>Last updated {LEGAL.updated}</p>

      <p>
        These terms are an agreement between you and {operator}, who operates {product} from {country} (&ldquo;we&rdquo;,
        &ldquo;us&rdquo;). By creating an account or using {product} you accept them. If you use {product} for a company,
        you accept them on its behalf and confirm you may do so; &ldquo;you&rdquo; then means the company.
      </p>

      <h2>1. What {product} is</h2>
      <p>
        {product} is a web application for software teams. It searches public sources such as Hacker News, GitHub, Stack
        Overflow, Reddit, X, app store reviews and other sites for the product and competitor names you choose, stores the
        public mentions it finds, and uses AI to sort them into bugs, feature requests, complaints and praise. You use it in
        your browser; nothing is installed or shipped to you.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must be at least 18 and give a real email address.</li>
        <li>Keep your login safe. You are responsible for what happens in your account and workspaces.</li>
        <li>Workspace owners decide who is a member and what they can see, and are responsible for their members&rsquo; use of the workspace.</li>
        <li>Tell us at {mail} if you think someone else is using your account.</li>
      </ul>

      <h2>3. Plans and payment</h2>
      <ul>
        <li>There is a free plan and paid plans, billed monthly or yearly. Each plan&rsquo;s prices, keyword limit and monthly mention allowance are shown on the <Link href="/#pricing">pricing section</Link> and on your billing page.</li>
        <li>The free plan costs nothing and never turns into a paid plan on its own. Its limits may change; we will tell you first.</li>
        <li>
          Payments are processed by <strong>Dodo Payments</strong>, our merchant of record. Dodo Payments sells the
          subscription to you, charges your card, issues your invoice and handles sales tax, VAT or GST. Its own terms also
          apply to the payment.
        </li>
        <li>Paid plans renew automatically at the end of each month or year, depending on the billing you chose, until you cancel. Yearly billing is paid up front for the year; the mention allowance still renews every month. Prices are in US dollars, plus any tax shown at checkout.</li>
        <li>If you move to a different paid plan or billing interval, the change takes effect at once and the difference for the rest of the period is charged or credited.</li>
        <li>If a renewal payment fails, your workspace goes back to free-plan limits until the payment is made. Your data is kept.</li>
        <li>We may change prices. A new price applies from your next renewal after we tell you by email at least 14 days ahead.</li>
      </ul>

      <h2>4. The monthly mention allowance</h2>
      <p>
        Each plan includes a number of mentions a month. When they run out, new mentions are held, paid sources pause until
        the allowance renews, and nothing extra is charged: there are no overage fees, and your plan is never upgraded on its
        own. What counts as a mention is explained in the <Link href="/docs/mentions">docs</Link>.
      </p>

      <h2>5. Cancelling</h2>
      <p>
        You can cancel at any time from Settings → Billing → Manage billing. Your plan stays active until the end of the
        month or year you have paid for, then your workspace moves to the free plan. Refunds are covered by
        our <Link href="/legal/refunds">refund policy</Link>.
      </p>

      <h2>6. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use {product} to harass, stalk, track or build profiles of private individuals, or to discriminate against anyone;</li>
        <li>break the law, or the terms of the sources {product} searches, through your use of it;</li>
        <li>resell or share access to {product}, or resell or publish the mentions it collects as a dataset;</li>
        <li>use {product} to build a competing service, or copy, decompile or reverse engineer it, except where the law allows;</li>
        <li>probe, overload, scrape or get around the limits and security of {product};</li>
        <li>upload anything you have no right to share, or anything harmful such as malware.</li>
      </ul>
      <p>We may suspend an account that breaks these rules, and will tell you why unless the law prevents it.</p>

      <h2>7. Your data</h2>
      <p>
        The names, keywords, settings and notes you add are yours. You give us permission to store and process them only to
        run {product} for you. We keep them confidential and don&rsquo;t use them to train AI models. How we handle personal
        data is set out in our <Link href="/legal/privacy">privacy policy</Link>.
      </p>

      <h2>8. Public content from other sites</h2>
      <ul>
        <li>Mentions are public posts written by other people. They remain theirs; {product} shows them to you as they were posted, without checking that they are true.</li>
        <li>Use them in line with the source&rsquo;s terms and the law, especially if you republish them or contact their authors. You are responsible for that use, and you agree to cover us for claims that arise from it.</li>
        <li>Treat mentions as untrusted content. A post can contain text written to mislead AI tools, including your own Claude or AI agent when it reads mentions through {product}. Review what such tools suggest before acting on it.</li>
        <li>We may remove a mention, for example when its author asks or the law requires.</li>
      </ul>

      <h2>9. Connections and the Claude connector</h2>
      <p>
        You can connect {product} to other services, such as GitHub, Google Play, your own AI provider key or Claude. You
        choose what to connect and can disconnect at any time. Each service&rsquo;s own terms apply to your use of it, and
        usage of your own AI provider or Claude plan is billed by them, not by us. The Claude connector is read-only: Claude
        can read the workspace you approve but can&rsquo;t change anything in {product}.
      </p>

      <h2>10. AI results</h2>
      <p>
        {product} uses AI models to classify, group, rank and summarise mentions. The results can be wrong or incomplete,
        and the same mention can be sorted differently over time. Check anything important against the original mention,
        which {product} always links to.
      </p>

      <h2>11. Our software</h2>
      <p>
        {product}, its software, design and the name &ldquo;{product}&rdquo; belong to us. While your account is open, we
        give you a personal, non-exclusive, non-transferable right to use {product} under these terms. If you send us ideas
        or feedback, we may use them freely, with no obligation to you.
      </p>

      <h2>12. Availability and changes</h2>
      <p>
        We work to keep {product} running and to warn you ahead of planned maintenance, but it is provided &ldquo;as
        is&rdquo;, without a guarantee that it will always be available or that every mention will be found. Public sources
        can change or stop working without notice. We may change or remove features; if a change takes away something you
        pay for, you can cancel and ask for a refund of the unused part of the period you paid for.
      </p>

      <h2>13. Confidentiality</h2>
      <p>
        We keep what we learn about your business through {product} confidential and use it only to run {product} for you.
        We won&rsquo;t name you as a customer without your permission. If we share anything confidential with you, such as
        an early feature, please do the same.
      </p>

      <h2>14. Liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect or consequential loss, lost profits or lost data, and
        our total liability for any claim is limited to the amount you paid us in the 12 months before it. Nothing in these
        terms limits liability that cannot be limited by law, such as for fraud or for death or injury caused by negligence.
      </p>

      <h2>15. Ending the agreement</h2>
      <p>
        You can stop using {product} and delete your account at any time from Settings → Account. Deleting it removes your
        workspaces and their data. We may end the agreement, or suspend your account, if you seriously or repeatedly break
        these terms, or if we have to stop offering {product}; we will give you notice and a chance to export your data
        where we can. Sections 8, 11, 14 and 17 still apply after the agreement ends.
      </p>

      <h2>16. Law</h2>
      <p>
        These terms are governed by the laws of {country}. If a dispute comes up, write to us first and we will try to
        settle it within 30 days. If we can&rsquo;t, the courts of {country} have jurisdiction, without taking away any
        rights you have under the consumer law of where you live.
      </p>

      <h2>17. General</h2>
      <ul>
        <li>We use service providers to run {product}, listed in the privacy policy, and are responsible for them.</li>
        <li>We send notices by email to the account owner&rsquo;s address, or in the app.</li>
        <li>We are not responsible for delays or failures caused by events outside our reasonable control, such as outages of the services and sources {product} depends on.</li>
        <li>You may not transfer this agreement without our consent; we may transfer it to whoever takes over {product}, and will tell you.</li>
        <li>If part of these terms is found invalid, the rest still applies. Not enforcing a part is not giving it up.</li>
        <li>These terms, with the privacy and refund policies, are the whole agreement between us about {product}, unless we agree otherwise in writing.</li>
      </ul>

      <h2>18. Changes to these terms</h2>
      <p>
        We may update these terms. If a change matters, we will email account owners at least 14 days before it takes
        effect; if you don&rsquo;t agree, you can cancel before then.
      </p>

      <h2>Contact</h2>
      <p>Questions about these terms: {mail}.</p>
    </article>
  );
}
