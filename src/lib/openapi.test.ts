// The OpenAPI spec: valid shape, self-describing operations, and every path is a real route.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { openApiSpec } from "./openapi.ts";

const spec = openApiSpec("https://www.heardex.com");
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const ops = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item as Record<string, Record<string, unknown>>).filter(([m]) => METHODS.includes(m)).map(([method, op]) => ({ path, method, op })));

test("OpenAPI 3.1 document basics", () => {
  assert.equal(spec.openapi, "3.1.0");
  assert.ok(spec.info.title && spec.info.version && spec.info.description);
  assert.equal(spec.servers[0]!.url, "https://www.heardex.com");
  assert.ok(ops.length >= 8);
});

test("every operation has a unique operationId, a summary, a description and typed responses", () => {
  const ids = ops.map((o) => o.op.operationId as string);
  assert.equal(new Set(ids).size, ids.length);
  for (const { path, method, op } of ops) {
    const where = `${method.toUpperCase()} ${path}`;
    assert.match(op.operationId as string, /^[a-zA-Z][a-zA-Z0-9]*$/, where);
    assert.ok((op.summary as string)?.length > 3, `${where} summary`);
    assert.ok((op.description as string)?.length > 20, `${where} description`);
    const responses = op.responses as Record<string, { description: string }>;
    assert.ok(Object.keys(responses).length, `${where} responses`);
    for (const [code, r] of Object.entries(responses)) assert.ok(r.description, `${where} ${code} description`);
    for (const p of (op.parameters as Array<{ schema?: { type?: string }; description?: string }> | undefined) ?? []) {
      assert.ok(p.schema?.type && p.description, `${where} parameter typed and described`);
    }
  }
});

test("every $ref resolves", () => {
  const names = [...JSON.stringify(spec).matchAll(/"#\/components\/schemas\/([A-Za-z]+)"/g)].map((m) => m[1]!);
  assert.ok(names.length > 10);
  for (const name of names) assert.ok(name in spec.components.schemas, `${name} is defined`);
});

test("every path is a real route in src/app", () => {
  for (const path of Object.keys(spec.paths)) {
    const dir = new URL(`../app${path}/`, import.meta.url);
    // A route here, or an optional catch-all route under it.
    const found = ["route.ts", "page.tsx", "[[...path]]/route.ts"].some((f) => existsSync(new URL(f, dir)));
    assert.ok(found, `${path} has a route`);
  }
});
