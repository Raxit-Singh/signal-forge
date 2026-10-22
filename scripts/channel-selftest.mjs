// Runs the SignalForge channel against a fake SignalForge on localhost and checks
// that queued tasks arrive as channel notifications (once each), that expired
// tokens are refreshed, and that tool calls are proxied to /api/mcp.
// No network beyond 127.0.0.1, no real account.
//
//   node scripts/channel-selftest.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

const dir = await mkdtemp(join(tmpdir(), "sf-channel-"));
let access = "sfat_old_token_000000000000000000";
let refreshes = 0;
const calls = [];
const queue = [
  { task_id: "11111111-1111-1111-1111-111111111111", stage: "investigation", product_id: "p1", product: "toing", issue: "Login fails", category: "bug_report", created_at: "", message: "investigate t1" },
  { task_id: "22222222-2222-2222-2222-222222222222", stage: "investigation", product_id: "p2", product: "Other", issue: "x", category: null, created_at: "", message: "investigate t2" },
];

const http = createServer(async (req, res) => {
  const auth = req.headers.authorization ?? "";
  if (req.url === "/api/oauth/token") {
    let body = "";
    for await (const c of req) body += c;
    const f = new URLSearchParams(body);
    assert.equal(f.get("grant_type"), "refresh_token");
    assert.equal(f.get("refresh_token"), refreshes === 0 ? "sfrt_first" : "sfrt_second", "the rotated refresh token is used next time");
    refreshes++;
    access = `sfat_new_token_${refreshes}_00000000000000000`;
    return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: access, refresh_token: "sfrt_second", expires_in: 3600, token_type: "Bearer" }));
  }
  if (auth !== `Bearer ${access}`) return void res.writeHead(401).end();
  if (req.url === "/api/agent/queue") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ tasks: queue }));
  if (req.url === "/api/mcp") {
    const server = new McpServer({ name: "fake-signalforge", version: "1" });
    server.registerTool("get_agent_task", { description: "fake", inputSchema: { task_id: z.string() } }, async ({ task_id }) => {
      calls.push(task_id);
      return { content: [{ type: "text", text: `task ${task_id}` }] };
    });
    const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(t);
    let body = "";
    for await (const c of req) body += c;
    await t.handleRequest(req, res, body ? JSON.parse(body) : undefined);
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => http.listen(0, "127.0.0.1", r));
const site = `http://127.0.0.1:${http.address().port}`;
const stateFile = join(dir, "channel.json");
// An expired access token: the channel must refresh before polling.
await writeFile(stateFile, JSON.stringify({ [site]: { client_id: "sfc_test", access_token: "sfat_old_token_000000000000000000", refresh_token: "sfrt_first", expires_at: Date.now() - 1000, delivered: [] } }));

const got = [];
const client = new Client({ name: "fake-claude-code", version: "1" });
client.fallbackNotificationHandler = async (n) => { if (n.method === "notifications/claude/channel") got.push(n.params); };
await client.connect(new StdioClientTransport({
  command: process.execPath, args: ["channel/signalforge-channel.mjs"],
  env: { ...process.env, SIGNALFORGE_URL: site, SIGNALFORGE_CHANNEL_STATE: stateFile, SIGNALFORGE_PRODUCT: "toing", SIGNALFORGE_POLL_SECONDS: "5" },
  stderr: "pipe",
}));
assert.ok(client.getServerCapabilities()?.experimental?.["claude/channel"], "declares the channel capability");
assert.match(client.getInstructions() ?? "", /get_agent_task/);

await new Promise((r) => setTimeout(r, 7500)); // first poll at 1.5 s, second at ~6.5 s
assert.equal(got.length, 1, "only toing's task, and only once across polls");
assert.equal(got[0].content, "investigate t1");
assert.deepEqual(got[0].meta, { task_id: queue[0].task_id, stage: "investigation", product: "toing" });
assert.equal(refreshes, 1, "expired token refreshed once");

const tools = await client.listTools();
assert.deepEqual(tools.tools.map((t) => t.name), ["get_agent_task"], "SignalForge's tools are proxied");
const r = await client.callTool({ name: "get_agent_task", arguments: { task_id: queue[0].task_id } });
assert.equal(r.content[0].text, `task ${queue[0].task_id}`);
assert.deepEqual(calls, [queue[0].task_id]);

const saved = JSON.parse(await readFile(stateFile, "utf8"))[site];
assert.equal(saved.refresh_token, "sfrt_second", "rotated refresh token stored");
assert.deepEqual(saved.delivered, [queue[0].task_id]);

await client.close();
http.close();
console.log("channel self-test passed");
