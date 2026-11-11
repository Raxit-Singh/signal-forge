import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConsent, withConsent } from "./consent.ts";

test("cookie consent: only the two choices are read", () => {
  assert.equal(parseConsent("all"), "all");
  assert.equal(parseConsent("essential"), "essential");
  assert.equal(parseConsent("yes"), null);
  assert.equal(parseConsent(undefined), null);
});

test("cookie consent: lifetimes kept with all, dropped otherwise, deletions untouched", () => {
  const kept = { path: "/", maxAge: 100 };
  assert.deepEqual(withConsent(kept, "all"), kept);
  assert.deepEqual(withConsent(kept, "essential"), { path: "/" });
  assert.deepEqual(withConsent(kept, null), { path: "/" });
  assert.deepEqual(withConsent({ path: "/", expires: new Date(Date.now() + 1e6) }, "essential"), { path: "/" });
  assert.deepEqual(withConsent({ path: "/", maxAge: 0 }, "essential"), { path: "/", maxAge: 0 });
  const past = new Date(0);
  assert.deepEqual(withConsent({ path: "/", expires: past }, null), { path: "/", expires: past });
  assert.equal(withConsent(undefined, "essential"), undefined);
});
