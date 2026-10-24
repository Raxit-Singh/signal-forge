// Feedback page counts link to the posts behind them, over the same date range.
import { test } from "node:test";
import assert from "node:assert/strict";

import { feedbackMentionsHref } from "./feedback-filter.ts";

test("mentions links keep the selected date range and drop empty parameters", () => {
  assert.equal(feedbackMentionsHref("bugs"), "/mentions?feedback=bugs");
  assert.equal(feedbackMentionsHref("bugs", { range: "7d" }), "/mentions?feedback=bugs&range=7d");
  assert.equal(feedbackMentionsHref("praise", { range: "custom", from: "2026-10-01", to: "2026-10-10" }), "/mentions?feedback=praise&range=custom&from=2026-10-01&to=2026-10-10");
  assert.equal(feedbackMentionsHref("general", { range: undefined, from: "" }), "/mentions?feedback=general");
});
