import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeCursor, encodeCursor, formatCount, formatRelative, formatUtc } from "./format.ts";

const NOW = new Date("2026-10-14T12:00:00Z");

test("formatRelative", () => {
  assert.equal(formatRelative("2026-10-14T11:59:30Z", NOW), "just now");
  assert.equal(formatRelative("2026-10-14T11:00:00Z", NOW), "1 hour ago");
  assert.equal(formatRelative("2026-10-13T12:00:00Z", NOW), "yesterday");
  assert.equal(formatRelative("2026-10-01T12:00:00Z", NOW), "last week");
  assert.equal(formatRelative("2026-09-28T12:00:00Z", NOW), "2 weeks ago");
  assert.equal(formatRelative("2026-09-14T12:00:00Z", NOW), "last month");
});

test("formatUtc and formatCount", () => {
  assert.equal(formatUtc("2026-10-14T09:05:59.999Z"), "2026-10-14 09:05 UTC");
  assert.equal(formatCount(999), "999");
  assert.equal(formatCount(1234), "1.2K");
});

test("cursor round-trips and rejects tampering", () => {
  const c = encodeCursor("2026-10-14T12:00:00.000Z", "a20177e0-720f-4c08-ae63-1f75f3ccf70a");
  assert.deepEqual(decodeCursor(c), { publishedAt: "2026-10-14T12:00:00.000Z", id: "a20177e0-720f-4c08-ae63-1f75f3ccf70a" });
  assert.equal(decodeCursor(Buffer.from("2026-10-14|not-a-uuid").toString("base64url")), null);
  assert.equal(decodeCursor(Buffer.from("garbage),or(id.gt.0|a20177e0-720f-4c08-ae63-1f75f3ccf70a").toString("base64url")), null);
  assert.equal(decodeCursor("%%%"), null);
  assert.equal(decodeCursor(undefined), null);
});
