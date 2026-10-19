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

test("formatTime shows the viewer's zone and names it", async () => {
  const { formatTime } = await import("./format.ts");
  assert.equal(formatTime("2026-10-19T09:15:00Z", "Asia/Kolkata"), "Oct 19, 2026, 2:45 PM GMT+5:30");
  assert.equal(formatTime("2026-10-19T09:15:00Z", "America/New_York"), "Oct 19, 2026, 5:15 AM EDT");
  assert.equal(formatTime("2026-10-19T09:15:00Z", "Not/AZone"), "Oct 19, 2026, 9:15 AM UTC");
  assert.equal(formatTime("2026-10-19T20:00:00Z", "Asia/Tokyo", { dateOnly: true }), "Oct 20, 2026");
  assert.equal(formatTime("garbage"), "");
});
