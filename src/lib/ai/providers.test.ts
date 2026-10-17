// Gemini adapter (official @google/genai SDK) against a fake fetch: no network,
// no key, no spend. Checks the request shape and how responses are validated.
import { test } from "node:test";
import assert from "node:assert/strict";

import { EMBEDDING_DIMENSIONS, geminiClient } from "./providers.ts";
import { classificationPrompt, classificationSchema, type ClassificationOutput } from "./prompts.ts";
import { AiError, type AiCall } from "./types.ts";

const posts = [{ id: "m1", source: "hn", title: null, text: "It crashes" }];
const { system, user } = classificationPrompt({ name: "Acme", description: null, keywords: [] }, posts);
const call = (tier: "cheap" | "deep" = "cheap"): AiCall<ClassificationOutput> => ({ purpose: "classify", tier, system, user, schema: classificationSchema, schemaName: "classification", maxTokens: 500 });
const answer: ClassificationOutput = {
  items: [{
    id: "m1", relevance: "relevant", sentiment: "negative", category: "bug",
    signals: { bug: true, feature_request: false, usability: false, complaint: false, competitor_comparison: false, question: false, actionable: true },
    severity: "high", area: "startup", confidence: 0.8, reason: "crash",
  }],
};
const models = { cheap: "gemini-3.1-flash-lite", deep: "gemini-3.8-flash", embedding: "gemini-embedding-2" };

type Seen = { url: string; init: RequestInit; body: Record<string, unknown> | null };
function fakeFetch(status: number, body: unknown) {
  const seen: Seen[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = url instanceof Request ? url.url : String(url);
    const raw = init?.body ? String(init.body) : null;
    seen.push({ url: u, init: init ?? {}, body: raw ? JSON.parse(raw) : null });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, seen };
}
const header = (s: Seen, name: string) => new Headers(s.init.headers).get(name);
const reply = (text: string, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40, thoughtsTokenCount: 10, cachedContentTokenCount: 20 },
  modelVersion: "gemini-3.1-flash-lite", ...extra,
});

test("structured request: JSON schema, system instruction, key in a header (never the URL), cheap model for classification", async () => {
  const { f, seen } = fakeFetch(200, reply(JSON.stringify(answer)));
  const r = await geminiClient("AIzaFAKEKEY", models, { fetch: f }).generate(call());
  assert.equal(r.output.items[0]!.category, "bug");
  assert.deepEqual(r.usage, { inputTokens: 120, outputTokens: 50, cachedTokens: 20 }, "thinking tokens count as output");
  assert.equal(r.model, "gemini-3.1-flash-lite");
  const s = seen[0]!;
  assert.match(s.url, /models\/gemini-3\.1-flash-lite:generateContent/);
  assert.ok(!s.url.includes("AIzaFAKEKEY"), "the key never appears in the URL");
  assert.equal(header(s, "x-goog-api-key"), "AIzaFAKEKEY");
  const cfg = s.body!.generationConfig as Record<string, unknown>;
  assert.equal(cfg.responseMimeType, "application/json");
  assert.ok(cfg.responseJsonSchema, "the JSON Schema is sent");
  assert.ok(!JSON.stringify(cfg.responseJsonSchema).includes("maxItems"), "Gemini rejects array-length keywords (live 400); Zod still enforces them");
  assert.equal(cfg.temperature, 0);
  assert.match(JSON.stringify(s.body!.systemInstruction), /untrusted/);
  assert.equal(s.body!.tools, undefined, "no tools are ever offered");
});

test("deep tier uses the configured deep model", async () => {
  const { f, seen } = fakeFetch(200, reply(JSON.stringify(answer)));
  await geminiClient("k", models, { fetch: f }).generate(call("deep"));
  assert.match(seen[0]!.url, /gemini-3\.8-flash:generateContent/);
});

test("invalid output: wrong shape, non-JSON, cut-off and safety blocks are errors that keep the billed usage", async () => {
  const cases: Array<[unknown, string]> = [
    [reply(JSON.stringify({ items: [{ id: "m1", sentiment: "angry" }] })), "invalid_output"],
    [reply("Sure! Here you go"), "invalid_output"],
    [{ ...reply(JSON.stringify(answer)), candidates: [{ content: { parts: [{ text: "{" }] }, finishReason: "MAX_TOKENS" }] }, "invalid_output"],
    [{ ...reply(""), candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "SAFETY" }] }, "refused"],
    [{ promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 5 } }, "refused"],
  ];
  for (const [body, kind] of cases) {
    const { f } = fakeFetch(200, body);
    await assert.rejects(geminiClient("k", models, { fetch: f }).generate(call()), (e) => e instanceof AiError && e.kind === kind && (e.usage?.inputTokens ?? 0) > 0, kind);
  }
  const fenced = fakeFetch(200, reply("```json\n" + JSON.stringify(answer) + "\n```"));
  assert.equal((await geminiClient("k", models, { fetch: fenced.f }).generate(call())).output.items.length, 1, "fenced JSON is accepted");
});

test("HTTP errors map to retryable / permanent kinds", async () => {
  const err = (status: number) => ({ error: { code: status, message: `status ${status}`, status: "X" } });
  const kinds: Array<[number, string, boolean]> = [[401, "auth", false], [403, "auth", false], [402, "budget", false], [429, "rate_limited", true], [400, "bad_request", false], [503, "unavailable", true]];
  for (const [status, kind, retryable] of kinds) {
    const { f } = fakeFetch(status, err(status));
    await assert.rejects(geminiClient("k", models, { fetch: f }).generate(call()), (e) => e instanceof AiError && e.kind === kind && e.retryable === retryable, `${status}`);
  }
});

test("embeddings: requested dimension, one vector per text, usage estimated and marked so", async () => {
  const vec = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i % 7) / 7);
  const { f, seen } = fakeFetch(200, { embeddings: [{ values: vec }, { values: vec }] });
  const r = await geminiClient("k", models, { fetch: f }).embed(["first text", "second text"]);
  assert.equal(r.vectors.length, 2);
  assert.equal(r.estimated, true);
  assert.ok(r.usage.inputTokens > 0);
  assert.match(seen[0]!.url, /gemini-embedding-2:(batchEmbedContents|embedContent)/);
  assert.match(JSON.stringify(seen[0]!.body), new RegExp(`"outputDimensionality":${EMBEDDING_DIMENSIONS}`));
  const sent = JSON.stringify(seen[0]!.body);
  assert.ok(sent.includes("first text") && sent.includes("second text"));
  const requests = (seen[0]!.body as { requests?: unknown[] }).requests;
  assert.equal(requests?.length, 2, "one embedding request per text, not one combined content");
  const short = fakeFetch(200, { embeddings: [{ values: vec }] });
  await assert.rejects(geminiClient("k", models, { fetch: short.f }).embed(["a", "b"]), (e) => e instanceof AiError && e.kind === "invalid_output");
  await assert.rejects(geminiClient("k", { cheap: "x" }).embed(["a"]), (e) => e instanceof AiError && e.kind === "not_configured");
});
