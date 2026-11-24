// JSON-LD for the home page (schema.org): what Heardex is (SoftwareApplication, with its live prices) and who runs it
// (Organization, with how to reach them). Pure: the page passes in the plans and links.
import { LEGAL } from "./legal.ts";

export interface LdPlan { name: string; priceCentsMonthly: number; currency: string }

export function homeStructuredData(base: string, opts: { plans: readonly LdPlan[]; sameAs: readonly string[]; description: string }) {
  const org = {
    "@type": "Organization",
    "@id": `${base}/#organization`,
    name: LEGAL.product,
    url: base,
    logo: `${base}/apple-icon.png`,
    email: LEGAL.email,
    sameAs: [...opts.sameAs],
    contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", email: LEGAL.email, url: `${base}/legal/contact`, availableLanguage: ["English"] }],
    // The Contact page's area and city; there is no street address to publish.
    address: { "@type": "PostalAddress", addressLocality: "Vadodara", addressRegion: "Gujarat", addressCountry: "IN" },
  };
  const app = {
    "@type": "SoftwareApplication",
    "@id": `${base}/#software`,
    name: LEGAL.product,
    url: base,
    description: opts.description,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    publisher: { "@id": `${base}/#organization` },
    ...(opts.plans.length
      ? {
          offers: opts.plans.map((p) => ({
            "@type": "Offer",
            name: p.name,
            price: (p.priceCentsMonthly / 100).toFixed(2),
            priceCurrency: p.currency.toUpperCase(),
            url: `${base}/#pricing`,
            category: "subscription",
          })),
        }
      : {}),
  };
  const website = { "@type": "WebSite", "@id": `${base}/#website`, name: LEGAL.product, url: base, publisher: { "@id": `${base}/#organization` } };
  return { "@context": "https://schema.org", "@graph": [org, app, website] };
}

/** Serialises JSON-LD for a <script> element: `<` is escaped so the text can't close the element. */
export const jsonLdScript = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
