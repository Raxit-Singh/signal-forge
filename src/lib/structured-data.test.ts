// JSON-LD for the home page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { homeStructuredData, jsonLdScript } from "./structured-data.ts";

const ld = homeStructuredData("https://www.heardex.com", {
  plans: [{ name: "Starter", priceCentsMonthly: 7000, currency: "usd" }],
  sameAs: ["https://x.com/heardexhq"],
  description: "Track what people say about your product.",
});
const byType = (t: string) => ld["@graph"].find((n) => n["@type"] === t) as Record<string, unknown>;

test("SoftwareApplication with name, description, url and offers", () => {
  const app = byType("SoftwareApplication");
  assert.equal(ld["@context"], "https://schema.org");
  assert.equal(app.name, "Heardex");
  assert.equal(app.url, "https://www.heardex.com");
  assert.ok(app.description);
  assert.deepEqual(app.offers, [{ "@type": "Offer", name: "Starter", price: "70.00", priceCurrency: "USD", url: "https://www.heardex.com/#pricing", category: "subscription" }]);
});

test("Organization with contactPoint and address", () => {
  const org = byType("Organization");
  const cp = (org.contactPoint as Array<Record<string, string>>)[0]!;
  assert.equal(cp["@type"], "ContactPoint");
  assert.ok(cp.email && cp.contactType);
  assert.equal((org.address as Record<string, string>)["@type"], "PostalAddress");
  assert.deepEqual(org.sameAs, ["https://x.com/heardexhq"]);
});

test("no offers when there are no plans", () => {
  const app = homeStructuredData("https://x", { plans: [], sameAs: [], description: "d" })["@graph"][1] as Record<string, unknown>;
  assert.equal("offers" in app, false);
});

test("script text can't close the element", () => {
  assert.equal(jsonLdScript({ a: "</script><b>" }).includes("<"), false);
  assert.deepEqual(JSON.parse(jsonLdScript({ a: "</script>" })), { a: "</script>" });
});
