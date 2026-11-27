import { test } from "node:test";
import assert from "node:assert/strict";
import { bugReportEmail, cleanPagePath } from "./bug-report.ts";

test("cleanPagePath keeps only an app path", () => {
  assert.equal(cleanPagePath("https://www.heardex.com/feedback?range=7d&token=x"), "/feedback");
  assert.equal(cleanPagePath("/mentions/123"), "/mentions/123");
  assert.equal(cleanPagePath("http://localhost:3000/overview"), "/overview");
  assert.equal(cleanPagePath("https://evil.example/phish"), null);
  assert.equal(cleanPagePath(""), null);
});

test("bugReportEmail escapes the message and names the reporter", () => {
  const e = bugReportEmail({
    id: 7, message: "Chart <b>broke</b>\nsecond line", reporterEmail: "a@b.co", workspaceName: "Acme",
    pagePath: "/feedback", userAgent: "Safari", screenshot: true, siteUrl: "https://www.heardex.com",
  });
  assert.equal(e.subject, "Bug #7: Chart <b>broke</b>");
  assert.match(e.html, /Chart &lt;b&gt;broke&lt;\/b&gt;/);
  assert.doesNotMatch(e.html, /<b>broke/);
  assert.match(e.text, /Page: https:\/\/www\.heardex\.com\/feedback/);
  assert.match(e.text, /Screenshot: attached/);
});
