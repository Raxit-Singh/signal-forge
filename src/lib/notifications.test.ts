import { test } from "node:test";
import assert from "node:assert/strict";
import { allowanceNotice, backfillNotice, newIssuesNotice, spikeNotice } from "./notifications.ts";

test("allowanceNotice says nothing below 80% and explains holding when used up", () => {
  assert.equal(allowanceNotice("ok", 50, 10000, "2026-12-01T00:00:00Z"), null);
  assert.match(allowanceNotice("warning", 80, 10000, "2026-12-01T00:00:00Z")!.title, /80%/);
  const out = allowanceNotice("exhausted", 100, 10000, "2026-12-01T00:00:00Z")!;
  assert.equal(out.title, "Mention allowance used up");
  assert.match(out.body, /held, not lost/);
  assert.match(out.body, /1 Dec/);
});

test("backfillNotice counts what was found", () => {
  assert.match(backfillNotice("Acme", 1234, "completed").body, /^1,234 earlier mentions found\.$/);
  assert.match(backfillNotice("Acme", 1, "partial").body, /1 earlier mention found, though/);
  assert.match(backfillNotice("Acme", 0, "completed").body, /No earlier mentions/);
});

test("newIssuesNotice: one issue by name, several summed up", () => {
  assert.equal(newIssuesNotice("Acme", []), null);
  const one = newIssuesNotice("Acme", [{ title: "Login fails on Android", category: "bug_report" }])!;
  assert.equal(one.title, "New bug in Acme");
  assert.equal(one.kind, "bug");
  assert.equal(one.body, "Login fails on Android");
  const many = newIssuesNotice("Acme", ["a", "b", "c", "d", "e"].map((t) => ({ title: t, category: "feature_request" })))!;
  assert.equal(many.kind, "feature_cluster");
  assert.equal(many.title, "5 new issues in Acme");
  assert.equal(many.body, "a · b · c and 2 more");
});

test("spikeNotice compares with a normal day", () => {
  assert.match(spikeNotice("Acme", 90, 30, "2026-11-20T00:00:00Z").body, /90 mentions on 20 Nov, about 3\.0× a normal day/);
  assert.doesNotMatch(spikeNotice("Acme", 12, 10, "2026-11-20T00:00:00Z").body, /×/);
});
