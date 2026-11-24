// Route rules for the proxy: what exists, what needs sign-in, real 404s and Markdown negotiation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { apiNotFound, APP_PREFIXES, isApiPath, isAppPath, isPublicPath, notFoundMarkdown, prefersMarkdown, PUBLIC_PREFIXES } from "./routes.ts";

test("unknown paths are neither public nor app (so they 404 instead of redirecting to sign in)", () => {
  for (const p of ["/some-path-that-does-not-exist", "/wp-admin", "/overviewx", "/docsx", "/api/nope"]) {
    assert.equal(isPublicPath(p), false, p);
    assert.equal(isAppPath(p), false, p);
  }
});

test("public pages and files", () => {
  for (const p of ["/", "/login", "/docs", "/docs/mcp", "/blog/x", "/legal/terms", "/openapi.json", "/index.md", "/llms.txt", "/opengraph-image"]) assert.ok(isPublicPath(p), p);
  assert.equal(isPublicPath("/prototypes/x"), false);
  assert.ok(isPublicPath("/prototypes/x", { prototypes: true }));
});

test("app pages need sign-in", () => {
  for (const p of ["/overview", "/settings/billing", "/oauth/authorize", "/invite/abc", "/api/github/install", "/reset-password"]) assert.ok(isAppPath(p), p);
  assert.equal(isAppPath("/"), false);
});

test("every top-level route in src/app is classified", () => {
  const app = new URL("../app/", import.meta.url);
  // Not pages: route groups, private folders, special files and handlers that the proxy skips or that answer for themselves.
  const skip = new Set(["actions", "api", ".well-known", "llms.txt", "index.md", "openapi.json", "prototypes"]);
  const segments = readdirSync(app, { withFileTypes: true }).filter((d) => d.isDirectory() && !skip.has(d.name));
  const groups = segments.filter((d) => d.name.startsWith("("));
  const names = [
    ...segments.filter((d) => !d.name.startsWith("(")).map((d) => d.name),
    ...groups.flatMap((g) => readdirSync(new URL(`${g.name}/`, app), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)),
  ];
  for (const n of names) {
    const p = `/${n}`;
    assert.ok(isPublicPath(p) || isAppPath(p), `${p} is neither in PUBLIC_PREFIXES nor APP_PREFIXES (src/lib/routes.ts)`);
  }
  assert.equal(new Set([...PUBLIC_PREFIXES, ...APP_PREFIXES]).size, PUBLIC_PREFIXES.length + APP_PREFIXES.length);
});

test("api paths", () => {
  assert.ok(isApiPath("/api"));
  assert.ok(isApiPath("/api/x"));
  assert.equal(isApiPath("/apix"), false);
});

test("Markdown negotiation", () => {
  assert.ok(prefersMarkdown("text/markdown"));
  assert.ok(prefersMarkdown("text/markdown, text/html;q=0.9"));
  assert.ok(prefersMarkdown("text/markdown;q=1, */*;q=0.8"));
  assert.ok(prefersMarkdown("TEXT/MARKDOWN"));
  assert.equal(prefersMarkdown("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"), false); // a browser
  assert.equal(prefersMarkdown("text/html, text/markdown;q=0.5"), false);
  assert.equal(prefersMarkdown("text/markdown;q=0"), false);
  assert.equal(prefersMarkdown("*/*"), false);
  assert.equal(prefersMarkdown(null), false);
  assert.equal(prefersMarkdown(""), false);
});

test("404 bodies point agents somewhere useful", () => {
  const md = notFoundMarkdown("/nope`x", "https://www.heardex.com");
  assert.match(md, /^# 404/);
  assert.ok(md.length > 20);
  assert.match(md, /https:\/\/www\.heardex\.com\/llms\.txt/);
  assert.match(md, /sitemap\.xml/);
  assert.ok(!md.includes("nope`x"));
  const j = apiNotFound("/api/nope", "https://www.heardex.com");
  assert.equal(j.error.code, "not_found");
  assert.match(j.error.hint, /openapi\.json/);
});
