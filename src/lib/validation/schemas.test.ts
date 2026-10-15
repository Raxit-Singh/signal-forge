import { test } from "node:test";
import assert from "node:assert/strict";
import {
  productSchema, aliasListSchema, signUpSchema, newPasswordSchema, workspaceNameSchema, fieldErrors,
} from "./schemas.ts";

test("product schema normalizes and parses optional URLs", () => {
  const r = productSchema.safeParse({
    name: "  FocusFlow ",
    websiteUrl: "focusflow.app",
    description: "",
    githubRepo: "https://github.com/acme/focusflow.git",
    appStoreUrl: "",
  });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.equal(r.data.name, "FocusFlow");
  assert.deepEqual(r.data.websiteUrl, { url: "https://focusflow.app", domain: "focusflow.app" });
  assert.equal(r.data.description, null);
  assert.equal(r.data.githubRepo?.fullName, "acme/focusflow");
  assert.equal(r.data.appStoreUrl, null);
  assert.equal(r.data.playStoreUrl, null);
});

test("product schema reports field-level errors", () => {
  const r = productSchema.safeParse({ name: "", websiteUrl: "http://localhost", githubRepo: "nope" });
  assert.equal(r.success, false);
  const errs = fieldErrors(r.error!);
  assert.ok(errs.name);
  assert.match(errs.websiteUrl ?? "", /public domain/);
  assert.match(errs.githubRepo ?? "", /owner\/repository/);
});

const alias = (over: Record<string, unknown> = {}) => ({
  term: "FocusFlow", kind: "exact_name", isAmbiguous: false, contextTerms: [], negativeTerms: [],
  enabled: true, source: "suggested", ...over,
});

test("alias list rules", () => {
  assert.ok(aliasListSchema.safeParse([alias()]).success);
  assert.equal(aliasListSchema.safeParse([]).success, false, "empty list");
  assert.equal(aliasListSchema.safeParse([alias({ enabled: false })]).success, false, "none enabled");
  assert.equal(aliasListSchema.safeParse([alias(), alias({ term: "focusflow" })]).success, false, "case-insensitive duplicate");
  assert.equal(aliasListSchema.safeParse([alias({ term: "Linear", isAmbiguous: true })]).success, false, "ambiguous without context");
  const ok = aliasListSchema.safeParse([alias({ term: "Linear", isAmbiguous: true, contextTerms: ["Issues", "issues", "jira"] })]);
  assert.ok(ok.success);
  assert.deepEqual(ok.data[0]?.contextTerms, ["issues", "jira"], "context terms lowercased + deduped");
});

test("password policy and confirmation", () => {
  assert.equal(signUpSchema.safeParse({ email: "a@b.co", password: "short1" }).success, false);
  assert.equal(signUpSchema.safeParse({ email: "a@b.co", password: "longenoughbutnodigits" }).success, false);
  const ok = signUpSchema.safeParse({ email: " A@B.CO ", password: "correct horse 9" });
  assert.ok(ok.success);
  assert.equal(ok.data.email, "a@b.co");
  const mismatch = newPasswordSchema.safeParse({ password: "abcdefghij1", confirm: "abcdefghij2" });
  assert.equal(mismatch.success, false);
  assert.equal(fieldErrors(mismatch.error!).confirm, "Passwords don't match.");
});

test("workspace name trimmed and bounded", () => {
  assert.equal(workspaceNameSchema.safeParse({ name: "   " }).success, false);
  assert.equal(workspaceNameSchema.safeParse({ name: "x".repeat(81) }).success, false);
  assert.equal(workspaceNameSchema.parse({ name: "  Acme  " }).name, "Acme");
});
