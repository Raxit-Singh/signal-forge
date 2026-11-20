import { test } from "node:test";
import assert from "node:assert/strict";
import { earlyAccessList, hasEarlyAccess } from "./early-access.ts";

function withList(value: string | undefined, fn: () => void) {
  const before = process.env.EARLY_ACCESS_EMAILS;
  if (value === undefined) delete process.env.EARLY_ACCESS_EMAILS;
  else process.env.EARLY_ACCESS_EMAILS = value;
  try { fn(); } finally {
    if (before === undefined) delete process.env.EARLY_ACCESS_EMAILS;
    else process.env.EARLY_ACCESS_EMAILS = before;
  }
}

test("open to everyone when the list is unset or blank", () => {
  withList(undefined, () => { assert.equal(earlyAccessList(), null); assert.ok(hasEarlyAccess("anyone@x.com")); assert.ok(hasEarlyAccess(null)); });
  withList(" , ", () => { assert.equal(earlyAccessList(), null); assert.ok(hasEarlyAccess("anyone@x.com")); });
});

test("only listed addresses, ignoring case and spaces", () => {
  withList(" Owner@Example.com ,tester@example.com", () => {
    assert.ok(hasEarlyAccess("owner@example.com"));
    assert.ok(hasEarlyAccess("TESTER@example.com "));
    assert.ok(!hasEarlyAccess("stranger@example.com"));
    assert.ok(!hasEarlyAccess("owner@example.com.evil.com"));
    assert.ok(!hasEarlyAccess(null));
    assert.ok(!hasEarlyAccess(""));
  });
});
