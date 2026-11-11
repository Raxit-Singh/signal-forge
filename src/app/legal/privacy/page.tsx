import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  const { product, operator, country, email } = LEGAL;
  const mail = <a href={`mailto:${email}`}>{email}</a>;
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p>Last updated {LEGAL.updated}</p>

      <p>
        This policy explains what personal data {product} collects, why, who it is shared with and what you can do about
        it. It covers the {product} website and app. {product} is operated by {operator}, {country}, who decides how this
        data is used and is responsible for it (the &ldquo;controller&rdquo;). Contact: {mail}.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your email address, your name if you give it, and, if you sign in with Google, the basic profile Google shares (name, email, picture).</li>
        <li><strong>Workspace content:</strong> product and competitor names, websites, keywords, settings, saved views and notes you add, and who is a member of each workspace.</li>
        <li><strong>Connections and keys you choose to add:</strong> for example a GitHub, Discord or Google Play connection, or your own AI provider key. These are stored encrypted, tied to your workspace.</li>
        <li><strong>Billing details:</strong> your plan, billing interval, subscription status and Dodo Payments customer id. Card details are entered on Dodo Payments&rsquo; checkout and never reach us.</li>
        <li><strong>Support messages:</strong> what you write to us and our replies.</li>
        <li><strong>Technical data:</strong> sign-in sessions, IP address and browser information in server logs, kept for security and fixing errors. We don&rsquo;t use analytics or advertising trackers.</li>
        <li><strong>Public mentions:</strong> public posts that contain your keywords. See the next section.</li>
      </ul>

      <h2>2. People in the posts we collect</h2>
      <p>
        {product} searches public sources for the names our customers track and stores the public posts it finds. A post
        can include its author&rsquo;s public username or name, what they wrote, when, and a link to it. We collect only
        what the source shows publicly, to tell our customers what is being said about their products.
      </p>
      <ul>
        <li>We don&rsquo;t collect private messages, and we don&rsquo;t combine posts to build profiles of individuals.</li>
        <li>Each post is kept in the workspace of the customer who tracks that name, for the history their plan includes, and always links back to the original.</li>
        <li>If you wrote a post that {product} collected and want it removed, or want to object, email {mail} with a link to it. We remove it from {product}; deleting the original is up to the site it was posted on.</li>
      </ul>

      <h2>3. Why we use it, and on what basis</h2>
      <ul>
        <li><strong>To provide {product}</strong> (because it is needed for the contract with you): run your account, search for your keywords, store and sort mentions, send the reports you ask for and answer support.</li>
        <li><strong>To take payment and keep records</strong> (contract, and legal obligation for tax and accounting).</li>
        <li><strong>To keep {product} secure</strong>, prevent abuse and fix problems (our legitimate interest in a safe, working service).</li>
        <li><strong>To collect and sort public posts</strong> (our customers&rsquo; and our legitimate interest in understanding public feedback about products, weighed against the authors&rsquo; interests: only public posts, no profiling, removal on request).</li>
        <li><strong>To email you</strong> about your account, billing and important changes (contract). Weekly reports and any product news are sent only if you have them on, and you can turn them off at any time (consent).</li>
      </ul>
      <p>We don&rsquo;t sell personal data, don&rsquo;t share it for advertising and don&rsquo;t use your workspace content to train AI models.</p>

      <h2>4. Who we share it with</h2>
      <p>Only with the services that run {product}, each for its own part:</p>
      <ul>
        <li><strong>Supabase</strong>: database and sign-in; holds your account and workspace data.</li>
        <li><strong>Vercel</strong>: hosts the website and app; handles requests and server logs.</li>
        <li><strong>Dodo Payments</strong>: merchant of record; checkout, subscriptions, invoices and tax. Receives your email, name, billing address and payment details.</li>
        <li><strong>Google (Gemini API)</strong>: sorts and summarises mentions; receives the text of mentions and your product&rsquo;s name and description.</li>
        <li><strong>Resend</strong>: sends account and report emails; receives your email address and the email&rsquo;s content.</li>
        <li><strong>Search providers and source APIs</strong> (such as API Direct, Serper, TikHub, the GitHub, Stack Exchange, YouTube and Hacker News APIs): receive your keywords, not your account details, to search public sites.</li>
        <li><strong>Your own AI provider</strong> (Anthropic, OpenAI or Google), only if you add your own key: mentions are sorted under your account with that provider, and its terms apply.</li>
        <li><strong>AI apps you connect</strong> (such as Claude, ChatGPT, Cursor or VS Code), only if you connect them: the app reads the workspace you approve through the {product} connector, under your own account with that app and its provider&rsquo;s terms (Anthropic, OpenAI, Cursor, Microsoft or GitHub). It can&rsquo;t change your settings or data; it can only send back reports and progress for developer-agent tasks you start.</li>
      </ul>
      <p>We may also disclose data where the law requires it, or to protect our rights or someone&rsquo;s safety.</p>

      <h2>5. International transfers</h2>
      <p>
        {product} is run from {country}, and some of the services above store or process data elsewhere, including in the
        United States and the European Union. Where the law requires safeguards for these transfers, we rely on the
        providers&rsquo; data protection terms, such as the European Commission&rsquo;s Standard Contractual Clauses.
      </p>

      <h2>6. How long we keep it</h2>
      <ul>
        <li>Account and workspace data: while your account exists.</li>
        <li>Stored mentions: for the history your plan includes, or until they are removed on request.</li>
        <li>When you delete your account in Settings → Account, the workspaces you own and their data are deleted.</li>
        <li>Billing and tax records: as long as tax law requires, by us and Dodo Payments.</li>
        <li>Server logs: only as long as needed for security and fixing errors.</li>
        <li>If we close an account for abuse (see the terms, section 6): the email address, payment reference and reason, for up to three years, only to stop the same abuse happening again.</li>
      </ul>

      <h2>7. Cookies</h2>
      <p>
        {product} uses only the cookies it needs: to keep you signed in, protect sign-in, remember which workspace and
        product you last opened, and show times in your time zone. On your first visit we ask whether we may remember you
        after you close your browser; with &ldquo;Essential only&rdquo; these cookies last only for the browser session.
        Your light or dark theme is kept in your browser&rsquo;s storage. There are no advertising, analytics or tracking
        cookies. You can block cookies in your browser, but you won&rsquo;t be able to sign in. The{" "}
        <Link href="/legal/cookies">cookie policy</Link> lists each one.
      </p>

      <h2>8. Your rights</h2>
      <p>Depending on where you live, you have the right to:</p>
      <ul>
        <li>see the personal data we hold about you and get a copy, in a portable format;</li>
        <li>have it corrected, or deleted;</li>
        <li>object to, or ask us to restrict, how we use it;</li>
        <li>withdraw consent you gave, at any time;</li>
        <li>complain to your data protection authority.</li>
      </ul>
      <p>
        You can see and change most of your data in the app, export reports as CSV and delete your account at any time. For
        anything else, email {mail}; we reply within 30 days and may ask you to confirm who you are. This includes rights
        under the GDPR, India&rsquo;s Digital Personal Data Protection Act (write to the same address with any grievance), and
        California law, under which you can ask what we collect and have it deleted. We don&rsquo;t sell or share personal
        data in the sense of California law, and we won&rsquo;t treat you differently for using your rights.
      </p>

      <h2>9. Security</h2>
      <p>
        Data is encrypted in transit, connection tokens and keys are encrypted at rest, and each workspace&rsquo;s data is
        kept apart by database access rules. No system is perfectly secure. If a breach affects your personal data, we will
        tell you and the authorities where the law requires, without undue delay.
      </p>

      <h2>10. Children</h2>
      <p>{product} is not for anyone under 18, and we don&rsquo;t knowingly collect their data. If you think we hold a child&rsquo;s data, tell us and we will delete it.</p>

      <h2>11. Links to other sites</h2>
      <p>Mentions and pages in {product} link to other sites. Their own privacy policies apply there, not this one.</p>

      <h2>12. Changes</h2>
      <p>
        We will update this page when our practices change and show the date at the top. If a change matters, we will email
        account owners or show a notice in the app before it applies.
      </p>

      <h2>Contact</h2>
      <p>{operator}, {country}. Email {mail}.</p>
    </article>
  );
}
