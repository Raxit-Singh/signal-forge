import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { parseKeyRing, encryptSecret, decryptSecret, needsRotation } from "./crypto.ts";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");

test("round-trips and never contains the plaintext", () => {
  const ring = parseKeyRing(k1, "1", "");
  const { ciphertext, keyVersion } = encryptSecret(ring, "sk-ant-secret-value", "ws-1");
  assert.equal(keyVersion, 1);
  assert.ok(ciphertext.startsWith("v1:"));
  assert.ok(!ciphertext.includes("secret-value"));
  assert.equal(decryptSecret(ring, ciphertext, "ws-1"), "sk-ant-secret-value");
});

test("uses a fresh IV each time", () => {
  const ring = parseKeyRing(k1, "1", "");
  assert.notEqual(encryptSecret(ring, "x", "ws").ciphertext, encryptSecret(ring, "x", "ws").ciphertext);
});

test("binds ciphertext to its workspace (AAD)", () => {
  const ring = parseKeyRing(k1, "1", "");
  const { ciphertext } = encryptSecret(ring, "secret", "ws-1");
  assert.throws(() => decryptSecret(ring, ciphertext, "ws-2"));
});

test("detects tampering", () => {
  const ring = parseKeyRing(k1, "1", "");
  const { ciphertext } = encryptSecret(ring, "secret", "ws");
  const body = Buffer.from(ciphertext.slice(3), "base64");
  body[body.length - 1] = (body[body.length - 1] ?? 0) ^ 0xff;
  assert.throws(() => decryptSecret(ring, `v1:${body.toString("base64")}`, "ws"));
});

test("rotation: old rows decrypt with previous key, new rows use current", () => {
  const oldRing = parseKeyRing(k1, "1", "");
  const { ciphertext: oldCt } = encryptSecret(oldRing, "legacy", "ws");
  const newRing = parseKeyRing(k2, "2", `1:${k1}`);
  assert.equal(decryptSecret(newRing, oldCt, "ws"), "legacy");
  assert.equal(needsRotation(newRing, oldCt), true);
  const { ciphertext: newCt } = encryptSecret(newRing, "legacy", "ws");
  assert.equal(needsRotation(newRing, newCt), false);
  // Once the old key is dropped, old rows can no longer be read.
  assert.throws(() => decryptSecret(parseKeyRing(k2, "2", ""), oldCt, "ws"), /No key available/);
});

test("rejects bad key configuration", () => {
  assert.throws(() => parseKeyRing(undefined, "1", ""), /not set/);
  assert.throws(() => parseKeyRing(Buffer.alloc(16).toString("base64"), "1", ""), /32 bytes/);
  assert.throws(() => parseKeyRing(k1, "0", ""), /positive integer/);
  assert.throws(() => parseKeyRing(k1, "1", `1:${k2}`), /reuses/);
  assert.throws(() => parseKeyRing(k1, "2", "garbage"), /pairs/);
});
