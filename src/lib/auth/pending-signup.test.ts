import { test } from "node:test";
import assert from "node:assert/strict";
import { PENDING_SIGNUP_TTL_SECONDS, signPendingSignup, verifyPendingSignup } from "./pending-signup.ts";

const key = Buffer.alloc(32, 7);
const id = "3f1c2e4a-1b2c-4d5e-8f90-123456789abc";

test("round trip", () => {
  assert.equal(verifyPendingSignup(key, signPendingSignup(key, id)), id);
});

test("expires", () => {
  const t = signPendingSignup(key, id, 0);
  assert.equal(verifyPendingSignup(key, t, (PENDING_SIGNUP_TTL_SECONDS - 1) * 1000), id);
  assert.equal(verifyPendingSignup(key, t, (PENDING_SIGNUP_TTL_SECONDS + 1) * 1000), null);
});

test("rejects tampering, other keys and junk", () => {
  const t = signPendingSignup(key, id);
  const [body, mac] = t.split(".");
  const other = Buffer.from(JSON.stringify({ u: "00000000-0000-0000-0000-000000000000", exp: 9e9, n: "x" })).toString("base64url");
  assert.equal(verifyPendingSignup(key, `${other}.${mac}`), null);
  assert.equal(verifyPendingSignup(Buffer.alloc(32, 8), t), null);
  assert.equal(verifyPendingSignup(key, `${body}.${mac}.x`), null);
  for (const junk of [undefined, null, "", ".", "abc", `${body}.`]) assert.equal(verifyPendingSignup(key, junk), null);
});
