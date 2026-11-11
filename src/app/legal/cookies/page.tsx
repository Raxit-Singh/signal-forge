import type { Metadata } from "next";
import Link from "next/link";
import { CookieSettingsButton } from "@/components/cookie-banner";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Cookie Policy" };

// Every cookie and browser-storage item the site sets. Keep in step with the code that sets them:
// Supabase sign-in (src/lib/supabase), sf_ws and sf_product (src/app/actions/workspace.ts, product.ts, members.ts),
// sf_tz (src/components/time.tsx), hx_consent (src/app/actions/consent.ts) and the theme (next-themes).
// "How long" follows the visitor's choice (src/lib/consent.ts): with Essential only, the remembering cookies last for the
// browser session.
const COOKIES: { name: string; why: string; kept: string }[] = [
  { name: "sb-…-auth-token", why: "Keeps you signed in. Set by Supabase, our sign-in provider, when you sign in; long sessions are split into numbered parts (.0, .1).", kept: "Until you sign out, renewed while you use the app; with Essential only, until you close the browser" },
  { name: "sb-…-auth-token-code-verifier", why: "Protects signing in with Google or GitHub: it checks that the sign-in that comes back is the one you started.", kept: "A few minutes, while you sign in" },
  { name: "sf_ws", why: "Remembers which workspace you last opened.", kept: "1 year; with Essential only, until you close the browser" },
  { name: "sf_product", why: "Remembers which product you last opened.", kept: "1 year; with Essential only, until you close the browser" },
  { name: "sf_tz", why: "Your time zone, so dates and times show in your own time.", kept: "1 year; with Essential only, until you close the browser" },
  { name: "hx_consent", why: "Remembers the choice you made in the cookie banner, so it doesn't ask again.", kept: "1 year" },
];

export default function CookiesPage() {
  const { product, email } = LEGAL;
  const mail = <a href={`mailto:${email}`}>{email}</a>;
  return (
    <article>
      <h1>Cookie Policy</h1>
      <p>Last updated {LEGAL.updated}</p>

      <p>
        This page lists every cookie {product} sets and what each one is for. They are all there to make the site work:
        there are no advertising, analytics or tracking cookies, and no third-party scripts on our pages that set their own.
        On your first visit we ask whether {product} may remember you after you close your browser.
      </p>

      <h2>1. Cookies we set</h2>
      <div className="legal-table">
        <table>
          <thead><tr><th scope="col">Name</th><th scope="col">What it does</th><th scope="col">How long</th></tr></thead>
          <tbody>
            {COOKIES.map((c) => (
              <tr key={c.name}><td><code>{c.name}</code></td><td>{c.why}</td><td>{c.kept}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>2. Your choice</h2>
      <ul>
        <li><strong>Accept all:</strong> you stay signed in, and your workspace, product and time zone are remembered, for the times in the table.</li>
        <li><strong>Essential only:</strong> everything still works, but these cookies last only until you close your browser; next time you sign in again.</li>
      </ul>
      <p>Signing in always needs a cookie while you use the app; the choice is how long it lasts. You can change it at any time:</p>
      <p><CookieSettingsButton className="hx-nav is-quiet" /></p>

      <h2>3. Kept in your browser</h2>
      <p>
        Your choice of light or dark theme is kept in your browser&rsquo;s local storage under <code>theme</code>. It never
        leaves your device.
      </p>

      <h2>4. Other sites</h2>
      <p>
        When you pay, you do so on Dodo Payments&rsquo; checkout, and when you sign in with Google or GitHub, on theirs.
        Those sites set their own cookies under their own policies. Links to the posts {product} shows take you to the sites
        they come from, which do the same.
      </p>

      <h2>5. Turning cookies off</h2>
      <p>
        You can block or delete cookies in your browser&rsquo;s settings. The site&rsquo;s public pages still work, but you
        won&rsquo;t be able to sign in. Signing out deletes the sign-in cookies.
      </p>

      <h2>6. Changes</h2>
      <p>
        If we ever add a cookie that isn&rsquo;t needed for the site to work, we will ask for your consent to it first and
        update this page. See the <Link href="/legal/privacy">privacy policy</Link> for everything else about your data, or
        email {mail}.
      </p>
    </article>
  );
}
