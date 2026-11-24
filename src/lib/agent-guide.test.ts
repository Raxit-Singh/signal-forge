// The agent guide's tool list matches the MCP server's tools, and the when-to-use section is specific.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MCP_TOOLS, whenToUse } from "./agent-guide.ts";

test("MCP_TOOLS lists exactly the tools the MCP server registers", () => {
  const src = readFileSync(new URL("./server/agent/mcp.ts", import.meta.url), "utf8");
  const registered = [...src.matchAll(/\btool\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(MCP_TOOLS.map((t) => t.name).sort(), [...registered].sort());
});

test("when-to-use names the jobs, the tools and how to connect", () => {
  const text = whenToUse("https://www.heardex.com", "https://www.heardex.com/api/mcp").join("\n");
  assert.match(text, /^## When to use Heardex/);
  assert.match(text, /https:\/\/www\.heardex\.com\/api\/mcp/);
  assert.match(text, /OAuth/);
  assert.match(text, /Not a fit/);
  for (const t of MCP_TOOLS) assert.ok(text.includes(`\`${t.name}\``), t.name);
});
