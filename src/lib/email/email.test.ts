import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { esc, invitationEmail, weeklyReportEmail } from "./templates.ts";
import { unsubscribeToken, verifyUnsubscribe } from "./unsubscribe.ts";
import type { ReportData } from "../reports/weekly.ts";

test("invitation email: escaped names, single-line subject, plain-text part with the link", () => {
  const e = invitationEmail({ workspace: "Acme <script>\nBcc: x", inviter: 'Eve "<b>"', role: "viewer", link: "https://app.example/invite/abc", expires: new Date("2026-10-25T00:00:00Z") });
  assert.ok(!e.subject.includes("\n"), "no header injection through the subject");
  assert.ok(!e.html.includes("<script>") && e.html.includes("Acme &lt;script&gt;"));
  assert.ok(e.html.includes("Eve &quot;&lt;b&gt;&quot;"));
  assert.match(e.text, /Accept: https:\/\/app\.example\/invite\/abc/);
  assert.match(e.text, /a viewer \(read-only\)/);
  assert.equal(esc(`<a href="x">'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;");
});

test("weekly report email: numbers and highlights from the report, escaped post-derived titles, unsubscribe in both parts", () => {
  const d = {
    product: { id: "p", name: "Acme" }, period: { label: "5 Oct 2026 – 11 Oct 2026 (UTC)" },
    current: { mentions: 1234, uniqueAuthors: 56, sentiment: { negative: 7 } },
    highlights: ["1,234 relevant mentions (+20% vs the week before)."],
    issues: [{ title: "Login <img src=x onerror=alert(1)>", postsInPeriod: 3, isNew: true }],
  } as unknown as ReportData;
  const e = weeklyReportEmail(d, { report: "https://app.example/reports/r1", unsubscribe: "https://app.example/api/email/unsubscribe?t=abc", settings: "https://app.example/settings/account" });
  assert.equal(e.subject, "Acme: weekly report, 5 Oct 2026 – 11 Oct 2026 (UTC)");
  assert.ok(e.html.includes("1,234") && e.html.includes("+20% vs the week before"));
  assert.ok(!e.html.includes("<img") && e.html.includes("&lt;img"));
  assert.match(e.text, /Unsubscribe from weekly reports: https:\/\/app\.example\/api\/email\/unsubscribe\?t=abc/);
  assert.ok(e.html.includes("Unsubscribe from weekly reports"));
});

test("unsubscribe tokens: round trip; tampered, foreign-key and malformed tokens are rejected", () => {
  const key = randomBytes(32);
  const t = { u: "11111111-2222-3333-4444-555555555555", w: "66666666-7777-8888-9999-000000000000", k: "weekly_report" as const };
  const tok = unsubscribeToken(key, t);
  assert.deepEqual(verifyUnsubscribe(key, tok), t);
  assert.equal(verifyUnsubscribe(randomBytes(32), tok), null, "another key");
  const [body, mac] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ ...t, w: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" })).toString("base64url");
  assert.equal(verifyUnsubscribe(key, `${forged}.${mac}`), null, "changing the workspace breaks the signature");
  assert.equal(verifyUnsubscribe(key, `${body}`), null);
  assert.equal(verifyUnsubscribe(key, "x.y"), null);
});
