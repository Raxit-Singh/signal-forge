import type { Metadata } from "next";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  const { product, operator, country, email } = LEGAL;
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p>Last updated {LEGAL.updated}</p>

      <p>
        This policy explains what personal data {product} collects, why, who it is shared with and what you can do about
        it. {product} is operated by {operator}, {country}, who is responsible for your data. Contact:{" "}
        <a href={`mailto:${email}`}>{email}</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your email address, your name if you give it, and, if you sign in with Google, the basic profile Google shares (name, email, picture).</li>
        <li><strong>Workspace content:</strong> product and competitor names, keywords, settings, saved views and notes you add, and who is a member of each workspace.</li>
        <li><strong>Connections you choose to add:</strong> for example a GitHub or Discord connection. Their access tokens are stored encrypted.</li>
        <li><strong>Billing details:</strong> your plan, subscription status and Dodo Payments customer id. Card details are entered on Dodo Payments&rsquo; checkout and never reach us.</li>
        <li><strong>Technical data:</strong> sign-in sessions, IP address and browser information in server logs, kept for security and fixing errors.</li>
        <li><strong>Public mentions:</strong> public posts that contain your keywords, collected from public sources. They can include the author&rsquo;s public username and what they wrote.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To provide {product}: run your account, search for your keywords, store and sort mentions, and send the reports you ask for.</li>
        <li>To take payment and manage your subscription.</li>
        <li>To keep {product} secure, prevent abuse and fix problems.</li>
        <li>To email you about your account, billing and important changes. We don&rsquo;t send marketing email without your consent.</li>
      </ul>
      <p>
        We do this because it is needed to provide the service you signed up for, and, for security and abuse prevention,
        because we have a legitimate interest in it. We don&rsquo;t sell personal data and don&rsquo;t use it for advertising.
      </p>

      <h2>Who we share it with</h2>
      <p>Only with the services that run {product}, each for its own part:</p>
      <ul>
        <li><strong>Supabase</strong>: database and sign-in.</li>
        <li><strong>Vercel</strong>: hosting the website and app.</li>
        <li><strong>Dodo Payments</strong>: checkout, subscriptions, invoices and tax, as merchant of record.</li>
        <li><strong>Google (Gemini API)</strong>: AI sorting and summaries of mentions.</li>
        <li><strong>Resend</strong>: sending account and report emails.</li>
        <li><strong>Search providers</strong> (such as API Direct, Serper and TikHub): they receive your keywords, not your account details, to search public sites.</li>
      </ul>
      <p>
        Some of these services store data outside {country}, including in the United States and the European Union. We may
        also disclose data where the law requires it.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your data while your account exists. Stored mentions are kept for the history your plan includes. When you
        delete your account in Settings → Account, the workspaces you own and their data are deleted. Billing records are
        kept by Dodo Payments for as long as tax law requires.
      </p>

      <h2>Cookies</h2>
      <p>
        {product} uses only the cookies it needs: to keep you signed in and to remember which workspace and product you
        last opened. Your light or dark theme is kept in your browser&rsquo;s storage. There are no advertising or tracking
        cookies.
      </p>

      <h2>Your rights</h2>
      <p>
        You can see and change most of your data in the app, export reports as CSV, and delete your account at any time. You can also
        email us to ask for a copy of your data, a correction, deletion, or to object to how we use it. We reply within
        30 days. Depending on where you live, including under India&rsquo;s Digital Personal Data Protection Act and the
        GDPR, you can also complain to your data protection authority.
      </p>
      <p>
        If you wrote a public post that {product} has collected and want it removed from {product}, email us with a link to
        it.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, connection tokens are encrypted at rest, and each workspace&rsquo;s data is kept apart
        by database access rules. No system is perfectly secure; if a breach affects you, we will tell you.
      </p>

      <h2>Children</h2>
      <p>{product} is not for anyone under 18, and we don&rsquo;t knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>We will update this page when our practices change, and email account owners about significant changes.</p>
    </article>
  );
}
