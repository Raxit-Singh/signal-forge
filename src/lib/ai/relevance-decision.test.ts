import { test } from "node:test";
import assert from "node:assert/strict";
import { aiRelevanceDecision } from "./relevance-decision.ts";

test("a confident AI answer decides only mentions the rules left for review", () => {
  assert.equal(aiRelevanceDecision("pending", "yes", 0.9), "relevant");
  assert.equal(aiRelevanceDecision("pending", "no", 0.7), "irrelevant");
  assert.equal(aiRelevanceDecision("pending", "unsure", 0.95), null);
  assert.equal(aiRelevanceDecision("pending", "yes", 0.69), null);
  assert.equal(aiRelevanceDecision("pending", "yes", null), null);
  // Never overrides the rules or a person.
  assert.equal(aiRelevanceDecision("relevant", "no", 0.99), null);
  assert.equal(aiRelevanceDecision("irrelevant", "yes", 0.99), null);
  assert.equal(aiRelevanceDecision("user_irrelevant", "yes", 0.99), null);
  assert.equal(aiRelevanceDecision("user_relevant", "no", 0.99), null);
});
