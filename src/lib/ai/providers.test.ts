// Provider adapters against a fake fetch (no network, no keys, no spend).
import { test } from "node:test";
import assert from "node:assert/strict";

import { anthropicClient, geminiClient, openaiClient } from "./providers.ts";
import { classificationPrompt, classificationSchema, type ClassificationOutput } from "./prompts.ts";
import { AiError, type AiCall } from "./types.ts";

const posts = [{ id: "m1", source: "hn", title: null, text: "It crashes" }];
const { system, user } = classificationPrompt({ name: "Acme", description: null, keywords: [] }, posts);
const call = (tier: "cheap" | "deep" = "cheap"): AiCall<ClassificationOutput> => ({ purpose: "classify", tier, system, user, schema: classificationSchema, schemaName: "classification", maxTokens: 500 });
const answer: ClassificationOutput = { items: [{ id: "m1", about_product: "yes", sentiment: "negative", sentiment_confidence: 0.9, category: "bug_report", category_confidence: 0.8, reason: "crash" }] };

type Seen = { url: string; init: RequestInit; body: Record<string, unknown> | null };
function fakeFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const seen: Seen[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body ? String(init.body) : null;
    seen.push({ url: String(url), init: init ?? {}, body: raw ? JSON.parse(raw) : null });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }) as typeof fetch;
  return { f, seen };
}

const anthropicMessage = (text: string, stop = "end_turn") => ({
  id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: stop, stop_sequence: null,
  content: [{ type: "text", text }], usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});

test("anthropic: cheap tier = Haiku, low effort, no thinking; output parsed and validated; usage reported", async () => {
  const { f, seen } = fakeFetch(200, anthropicMessage(JSON.stringify(answer)));
  const r = await anthropicClient("sk-ant-test", { fetch: f }).generate(call());
  assert.equal(r.output.items[0]!.category, "bug_report");
  assert.deepEqual(r.usage, { inputTokens: 120, outputTokens: 40, cachedTokens: 0 });
  const body = seen[0]!.body!;
  assert.equal(body.model, "claude-haiku-5-5");
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal((body.output_config as { effort: string }).effort, "low");
  assert.equal((body.output_config as { format: { type: string } }).format.type, "json_schema");
  assert.equal(body.tools, undefined, "no tools are ever offered");
  assert.equal(new Headers(seen[0]!.init.headers).get("x-api-key"), "sk-ant-test");
});

test("anthropic: deep tier = Opus with server-side fallback; refusals and cut-off answers are errors with usage", async () => {
  const { f, seen } = fakeFetch(200, anthropicMessage(JSON.stringify(answer)));
  await anthropicClient("k", { fetch: f }).generate(call("deep"));
  assert.equal(seen[0]!.body!.model, "claude-opus-5-5");
  assert.equal(seen[0]!.body!.fallbacks, "default");
  assert.equal(seen[0]!.body!.thinking, undefined);
  assert.match(new Headers(seen[0]!.init.headers).get("anthropic-beta") ?? "", /server-side-fallback-2026-07-01/);

  const refused = fakeFetch(200, { ...anthropicMessage(""), content: [], stop_reason: "refusal" });
  await assert.rejects(anthropicClient("k", { fetch: refused.f }).generate(call()), (e) => e instanceof AiError && e.kind === "refused" && e.usage?.inputTokens === 120);
  const bad = fakeFetch(200, anthropicMessage(JSON.stringify({ items: [{ id: "m1", sentiment: "angry" }] })));
  await assert.rejects(anthropicClient("k", { fetch: bad.f }).generate(call()), (e) => e instanceof AiError && (e.kind === "invalid_output" || e.kind === "unavailable"));
});

test("anthropic: HTTP errors map to retryable / permanent kinds", async () => {
  const rl = fakeFetch(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, { "retry-after": "17" });
  await assert.rejects(anthropicClient("k", { fetch: rl.f, maxRetries: 0 }).generate(call()), (e) => e instanceof AiError && e.kind === "rate_limited" && e.retryable);
  const auth = fakeFetch(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  await assert.rejects(anthropicClient("k", { fetch: auth.f, maxRetries: 0 }).generate(call()), (e) => e instanceof AiError && e.kind === "auth" && !e.retryable);
  const v = await anthropicClient("k", { fetch: auth.f, maxRetries: 0 }).validate();
  assert.equal(v.ok, false);
  const list = fakeFetch(200, { data: [{ id: "claude-haiku-5-5", type: "model", display_name: "Haiku", created_at: "2026-01-01T00:00:00Z" }], has_more: false, first_id: "a", last_id: "a" });
  const ok = await anthropicClient("k", { fetch: list.f }).validate();
  assert.deepEqual(ok, { ok: true, models: ["claude-haiku-5-5"] });
  assert.match(list.seen[0]!.url, /\/v1\/models/, "validation lists models — no tokens used");
});

test("openai: JSON schema response format, usage incl. cached tokens, refusal and validation", async () => {
  const { f, seen } = fakeFetch(200, {
    model: "gpt-x", choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 50 } },
  });
  const r = await openaiClient("sk-test", "gpt-x", { fetch: f }).generate(call());
  assert.equal(r.output.items[0]!.sentiment, "negative");
  assert.deepEqual(r.usage, { inputTokens: 200, outputTokens: 30, cachedTokens: 50 });
  assert.equal((seen[0]!.body!.response_format as { type: string }).type, "json_schema");
  assert.equal(new Headers(seen[0]!.init.headers).get("authorization"), "Bearer sk-test");
  const refused = fakeFetch(200, { choices: [{ message: { content: null, refusal: "no" } }], usage: {} });
  await assert.rejects(openaiClient("k", "m", { fetch: refused.f }).generate(call()), (e) => e instanceof AiError && e.kind === "refused");
  const notJson = fakeFetch(200, { choices: [{ message: { content: "sure! here you go" } }], usage: {} });
  await assert.rejects(openaiClient("k", "m", { fetch: notJson.f }).generate(call()), (e) => e instanceof AiError && e.kind === "invalid_output");
  const models = fakeFetch(200, { data: [{ id: "gpt-x" }] });
  assert.deepEqual(await openaiClient("k", "gpt-x", { fetch: models.f }).validate(), { ok: true, models: ["gpt-x"] });
});

test("gemini: key in a header (never the URL), fenced JSON accepted, safety blocks are refusals", async () => {
  const { f, seen } = fakeFetch(200, {
    candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(answer) + "\n```" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
  });
  const r = await geminiClient("AIzaTEST", "models/gemini-x", { fetch: f }).generate(call());
  assert.equal(r.output.items[0]!.id, "m1");
  assert.equal(r.usage.outputTokens, 25, "thinking tokens are billed output");
  assert.ok(!seen[0]!.url.includes("AIzaTEST"));
  assert.match(seen[0]!.url, /models\/gemini-x:generateContent$/);
  assert.equal(new Headers(seen[0]!.init.headers).get("x-goog-api-key"), "AIzaTEST");
  const blocked = fakeFetch(200, { promptFeedback: { blockReason: "SAFETY" } });
  await assert.rejects(geminiClient("k", "g", { fetch: blocked.f }).generate(call()), (e) => e instanceof AiError && e.kind === "refused");
  const down = fakeFetch(503, { error: { message: "overloaded" } });
  await assert.rejects(geminiClient("k", "g", { fetch: down.f }).generate(call()), (e) => e instanceof AiError && e.kind === "unavailable" && e.retryable);
});
