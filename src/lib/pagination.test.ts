import { test } from "node:test";
import assert from "node:assert/strict";
import { pageCount, pageHref, pageItems, pageRange, parsePage } from "./pagination.ts";

test("page items: first, last, neighbours and ellipses (stable 7 slots)", () => {
  assert.deepEqual(pageItems(1, 18), [1, 2, 3, 4, 5, "ellipsis-end", 18]);
  assert.deepEqual(pageItems(9, 18), [1, "ellipsis-start", 8, 9, 10, "ellipsis-end", 18]);
  assert.deepEqual(pageItems(18, 18), [1, "ellipsis-start", 14, 15, 16, 17, 18]);
  assert.deepEqual(pageItems(3, 7), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pageItems(1, 1), [1]);
  assert.deepEqual(pageItems(99, 18).at(-1), 18, "out-of-range current is clamped");
  for (let total = 1; total <= 40; total++) {
    for (let p = 1; p <= total; p++) {
      const items = pageItems(p, total);
      assert.ok(items.includes(p), `${p}/${total} shows the current page`);
      assert.ok(items.length <= 7);
      const nums = items.filter((x): x is number => typeof x === "number");
      assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
      assert.equal(new Set(nums).size, nums.length);
    }
  }
});

test("page boundaries and result ranges", () => {
  assert.equal(pageCount(0, 20), 1);
  assert.equal(pageCount(292, 20), 15);
  assert.equal(pageCount(300, 20), 15);
  assert.equal(pageCount(301, 20), 16);
  assert.deepEqual(pageRange(2, 20, 292), { from: 21, to: 40 });
  assert.deepEqual(pageRange(15, 20, 292), { from: 281, to: 292 });
  assert.deepEqual(pageRange(1, 20, 0), { from: 0, to: 0 });
  // Pages partition the result set: no overlap, no gap.
  const total = 97;
  let next = 1;
  for (let p = 1; p <= pageCount(total, 20); p++) {
    const r = pageRange(p, 20, total);
    assert.equal(r.from, next);
    next = r.to + 1;
  }
  assert.equal(next, total + 1);
});

test("page param parsing is strict", () => {
  assert.equal(parsePage(undefined), 1);
  assert.equal(parsePage("3"), 3);
  for (const bad of ["0", "-1", "1.5", "abc", "3; drop", "9999999"]) assert.equal(parsePage(bad), bad === "0" ? 1 : 1, bad);
});

test("page links keep every filter and drop the legacy cursor", () => {
  const params = { source: "github", q: "dark mode", status: "all", type: "comment", range: "7d", cursor: "abc", page: "3" };
  assert.equal(pageHref("/mentions", params, 4), "/mentions?source=github&q=dark+mode&status=all&type=comment&range=7d&page=4");
  assert.equal(pageHref("/mentions", params, 1), "/mentions?source=github&q=dark+mode&status=all&type=comment&range=7d");
  assert.equal(pageHref("/mentions", {}, 1), "/mentions");
});
