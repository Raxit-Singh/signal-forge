import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Cookie Policy" };

// Every cookie and browser-storage item the site sets. Keep in step with the code that sets them:
// Supabase sign-in (src/lib/supabase), sf_ws and sf_product (src/app/actions/workspace.ts, product.ts, members.ts),
// sf_tz (src/components/time.tsx) and the theme (next-themes, src/components/theme-provider.tsx).
const COOKIES: { name: string; why: string; kept: string }[] = [
  { name: "sb-…-auth-token", why: "Keeps you signed in. Set by Supabase, our sign-in provider, when you sign in; long sessions are split into numbered parts (.0, .1).", kept: "Until you sign out, renewed while you use the app" },
  { name: "sb-…-auth-token-code-verifier", why: "Protects signing in with Google or GitHub: it checks that the sign-in that comes back is the one you started.", kept: "A few minutes, while you sign in" },
  { name: "sf_ws", why: "Remembers which workspace you last opened.", kept: "1 year" },
  { name: "sf_product", why: "Remembers which product you last opened.", kept: "1 year" },
  { name: "sf_tz", why: "Your time zone, so dates and times show in your own time.", kept: "1 year" },
];

export default function CookiesPage() {
  const { product, email } = LEGAL;
  const mail = <a href={`mailto:${email}`}>{email}</a>;
  return (
    <article>
      <h1>Cookie Policy</h1>
      <p>Last updated {LEGAL.updated}</p>

      <p>
        This page lists every cookie {product} sets and what each one is for. They are all needed for the site to work, so
        none of them asks for your consent and there is no cookie banner. There are no advertising, analytics or tracking
        cookies, and no third-party scripts on our pages that set their own.
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

      <h2>2. Kept in your browser</h2>
      <p>
        Your choice of light or dark theme is kept in your browser&rsquo;s local storage under <code>theme</code>. It never
        leaves your device.
      </p>

      <h2>3. Other sites</h2>
      <p>
        When you pay, you do so on Dodo Payments&rsquo; checkout, and when you sign in with Google or GitHub, on theirs.
        Those sites set their own cookies under their own policies. Links to the posts {product} shows take you to the sites
        they come from, which do the same.
      </p>

      <h2>4. Turning cookies off</h2>
      <p>
        You can block or delete cookies in your browser&rsquo;s settings. The site&rsquo;s public pages still work, but you
        won&rsquo;t be able to sign in. Signing out deletes the sign-in cookies.
      </p>

      <h2>5. Changes</h2>
      <p>
        If we ever add a cookie that isn&rsquo;t needed for the site to work, we will ask for your consent first and update
        this page. See the <Link href="/legal/privacy">privacy policy</Link> for everything else about your data, or
        email {mail}.
      </p>
    </article>
  );
}
