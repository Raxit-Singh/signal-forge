import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  adminInsert, adminSelect, createUser, createWorkspaceWithProduct, deleteUser, seedMentions, signInPath, type FixtureMention, type TestUser,
} from "./support";

// Developer agent (SYSTEM B) end to end against the dev server, with no Claude
// account: the test plays Claude's connector client (DCR → consent → PKCE token
// exchange → MCP tool calls) and the agent (get_agent_task / reports). Claude
// Code routines are replaced by the development-only stand-in endpoint, and the
// GitHub App (not configured here) by a stored installation + repository row.
// Nothing is executed in any real repository.

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const CALLBACK = "http://localhost:5555/callback";

let user: TestUser | null = null;
let other: TestUser | null = null;
let ids = { workspaceId: "", productId: "" };

const FIXTURES: FixtureMention[] = [
  { source: "hackernews", externalId: "ag-bug-1", title: "The app freezes when I log in", content: "The app freezes when I log in", hoursAgo: 30, author: "ann" },
  { source: "reddit", externalId: "ag-bug-2", title: "Opening the login screen makes the app hang", content: "Opening the login screen makes the app hang", hoursAgo: 29, author: "bo" },
  { source: "github", externalId: "ag-bug-3", title: "Signing in gets stuck forever", content: "Signing in gets stuck forever", hoursAgo: 28, author: "cy" },
  { source: "reddit", externalId: "ag-feat-1", title: "Please add dark mode", content: "Please add dark mode", hoursAgo: 27, author: "dee" },
  { source: "hackernews", externalId: "ag-feat-2", title: "Please add dark mode support", content: "Please add dark mode support", hoursAgo: 26, author: "eve" },
];

test.beforeEach(async () => {
  user = await createUser();
  ids = await createWorkspaceWithProduct(user);
  await seedMentions(ids.productId, ids.workspaceId, FIXTURES, 30);
});

test.afterEach(async () => {
  for (const u of [user, other]) if (u) await deleteUser(u.id);
  user = null;
  other = null;
});

const b64url = (b: Buffer) => b.toString("base64url");

async function mcp(token: string | null, name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: name === "tools/list" ? "tools/list" : "tools/call", params: name === "tools/list" ? {} : { name, arguments: args } }),
  });
  if (res.status !== 200) return { status: res.status, www: res.headers.get("www-authenticate"), error: true, text: await res.text(), data: null as unknown };
  const j = (await res.json()) as { result?: { content?: Array<{ text: string }>; isError?: boolean; tools?: Array<{ name: string }> } };
  if (name === "tools/list") return { status: 200, www: null, error: false, text: "", data: j.result?.tools ?? [] };
  const text = j.result?.content?.[0]?.text ?? "";
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { /* error text */ }
  return { status: 200, www: null, error: !!j.result?.isError, text, data };
}

async function form(url: string, body: Record<string, string>) {
  const res = await fetch(`${BASE}${url}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, string> };
}

/** Plays Claude's connector client: registration, consent in the browser, token exchange. */
async function connectClaude(page: Page) {
  const reg = await fetch(`${BASE}/api/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Claude (e2e)", redirect_uris: [CALLBACK], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" }),
  });
  expect(reg.status).toBe(201);
  const client = (await reg.json()) as { client_id: string };
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(8));
  let redirected = "";
  await page.route(`${CALLBACK}**`, (r) => { redirected = r.request().url(); return r.fulfill({ status: 200, body: "ok" }); });
  const q = new URLSearchParams({
    response_type: "code", client_id: client.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256",
    state, scope: "signalforge:read signalforge:agent", resource: `${BASE}/api/mcp`,
  });
  await page.goto(`/oauth/authorize?${q}`);
  await expect(page.getByRole("heading", { name: "Connect Claude (e2e) to SignalForge" })).toBeVisible();
  await expect(page.getByText("This returns to a program on your own computer")).toBeVisible();
  await expect(page.getByText(/start code changes on its own/)).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => redirected, { timeout: 15_000 }).toContain("code=");
  const back = new URL(redirected);
  expect(back.searchParams.get("state")).toBe(state);
  const code = back.searchParams.get("code")!;
  // A wrong PKCE verifier is refused (and the code is consumed: codes are single-use).
  const bad = await form("/api/oauth/token", { grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: CALLBACK, code_verifier: b64url(randomBytes(32)) });
  expect(bad.json.error).toBe("invalid_grant");
  return { client, verifier, challenge, getFreshCode: async () => {
    redirected = "";
    await page.goto(`/oauth/authorize?${new URLSearchParams({ ...Object.fromEntries(q), state: "s2" })}`);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => redirected, { timeout: 15_000 }).toContain("code=");
    return new URL(redirected).searchParams.get("code")!;
  } };
}

async function classify(page: Page) {
  await page.goto("/settings/ai");
  await page.getByRole("button", { name: "Use test classifier" }).click();
  await expect(page.locator("#main").getByTestId("ai-status")).toContainText("Test classifier");
  await page.goto("/feedback");
  await page.getByRole("button", { name: "Classify now" }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.locator("#main").getByTestId("feedback-issue")).toHaveCount(2, { timeout: 2000 });
  }).toPass({ timeout: 45_000 });
}

test("Claude connection, read-only MCP with workspace isolation, Investigate with Claude handoff, revocation", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(await signInPath(user!.email, "/settings/agent"));
  const main = page.locator("#main");
  // Simple card: one state and a Connect button; technical details only under "Having trouble connecting?".
  await expect(main.getByTestId("claude-state")).toHaveText("Not connected");
  await expect(main.getByTestId("claude-fallback")).not.toHaveAttribute("open", "");
  await expect(main.getByText("claude mcp add", { exact: false })).toBeHidden();
  await main.getByRole("button", { name: "Connect Claude" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect Claude" });
  await expect(dialog.getByLabel("SignalForge address for Claude")).toHaveValue(`${BASE}/api/mcp`);
  await expect(dialog.getByRole("link", { name: "Open Claude" })).toHaveAttribute("href", "https://claude.ai/customize/connectors");
  await expect(dialog.getByRole("status")).toContainText("Waiting for Claude");
  await dialog.getByRole("button", { name: "Close" }).click();
  await main.getByTestId("claude-fallback").locator("summary").click();
  await expect(main.getByTestId("claude-fallback")).toContainText("claude mcp add --transport http signalforge");
  await classify(page);

  // --- Connect Claude (OAuth 2.1 + PKCE), then the MCP server.
  const unauth = await mcp(null, "tools/list");
  expect(unauth.status).toBe(401);
  expect(unauth.www).toContain('resource_metadata="');
  const { client, verifier, getFreshCode } = await connectClaude(page);
  const code = await getFreshCode();
  const tok = await form("/api/oauth/token", { grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: "http://localhost:6123/callback", code_verifier: verifier });
  expect(tok.json.access_token, "loopback redirect matches on any port").toBeTruthy();
  const replay = await form("/api/oauth/token", { grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: CALLBACK, code_verifier: verifier });
  expect(replay.json.error, "codes are single-use").toBe("invalid_grant");
  // Code reuse revokes everything issued from it: get a clean grant.
  const code2 = await getFreshCode();
  const t2 = await form("/api/oauth/token", { grant_type: "authorization_code", code: code2, client_id: client.client_id, redirect_uri: CALLBACK, code_verifier: verifier });
  let access = t2.json.access_token!;
  // Approved, but Claude hasn't called SignalForge yet: "Connecting", never "Connected".
  await page.goto("/settings/agent");
  await expect(main.getByTestId("claude-state")).toHaveText("Connecting");
  expect((await mcp(tok.json.access_token!, "tools/list")).status, "the reused code's tokens were revoked").toBe(401);

  const tools = (await mcp(access, "tools/list")).data as Array<{ name: string }>;
  expect(tools.map((t) => t.name).sort()).toEqual([
    "get_agent_task", "get_feedback_issues", "get_implementation_context", "get_issue_details", "get_issue_evidence", "get_issue_priority",
    "get_product_context", "get_spike_analysis", "report_implementation_status", "submit_investigation_report",
  ].sort());
  const issues = (await mcp(access, "get_feedback_issues")).data as { issues: Array<{ id: string; title: string; category: string }> };
  expect(issues.issues.length).toBe(2);
  const bug = issues.issues.find((i) => i.category === "bug_report")!;
  const feature = issues.issues.find((i) => i.category === "feature_request")!;
  const evidence = (await mcp(access, "get_issue_evidence", { issue_id: bug.id })).data as { posts: unknown[]; note: string };
  expect(evidence.posts.length).toBe(3);
  expect(evidence.note).toMatch(/untrusted/);
  const priority = (await mcp(access, "get_issue_priority", { issue_id: bug.id })).data as { evidence: { observed: unknown; inferred: unknown } };
  expect(priority.evidence.observed && priority.evidence.inferred).toBeTruthy();

  // Workspace isolation: another workspace's issue is invisible through this token.
  other = await createUser();
  const otherWs = await createWorkspaceWithProduct(other, "OtherApp");
  await adminInsert("feedback_clusters", { workspace_id: otherWs.workspaceId, product_id: otherWs.productId, category: "bug_report", title: "Secret issue" });
  const [secret] = await adminSelect<Array<{ id: string }>>(`feedback_clusters?workspace_id=eq.${otherWs.workspaceId}&select=id`);
  const leak = await mcp(access, "get_issue_details", { issue_id: secret!.id });
  expect(leak.error).toBe(true);
  expect(leak.text).toMatch(/not found in this workspace/);
  expect(JSON.stringify((await mcp(access, "get_feedback_issues")).data)).not.toContain("Secret issue");

  // --- Connection status.
  await page.goto("/settings/agent");
  await expect(main.getByTestId("claude-state")).toHaveText("Connected");
  await expect(main.getByRole("button", { name: "Connect Claude" })).toHaveCount(0);
  await expect(main.getByTestId("agent-readiness")).toContainText("Claude has connected");

  // --- Investigate with Claude: a handoff to the user's own Claude; nothing is created or sent by SignalForge.
  await page.goto("/feedback");
  const bugCard = main.getByTestId("feedback-issue").filter({ hasText: "Bug reports" });
  const popup = page.waitForEvent("popup");
  await bugCard.getByTestId("investigate-claude").click();
  const chatUrl = (await popup).url();
  expect(chatUrl).toMatch(/^https:\/\/claude\.ai\/new\?q=Investigate%20SignalForge%20issue/);
  const typed = decodeURIComponent(new URL(chatUrl).searchParams.get("q") ?? "");
  expect(typed).toContain(`issue_id "${bug.id}"`);
  expect(typed).toContain("Ask me before changing any code.");
  expect(await adminSelect<unknown[]>(`agent_tasks?cluster_id=eq.${bug.id}&select=id`), "no task is created").toEqual([]);
  void feature;

  // --- Token rotation and revocation.
  const rotated = await form("/api/oauth/token", { grant_type: "refresh_token", refresh_token: t2.json.refresh_token!, client_id: client.client_id });
  expect(rotated.json.access_token).toBeTruthy();
  access = rotated.json.access_token!;
  expect((await mcp(access, "get_product_context")).status).toBe(200);
  await page.goto("/settings/agent");
  const connections = main.getByRole("list", { name: "Claude connections" }).getByRole("listitem");
  await expect(connections.first()).toBeVisible();
  const before = await connections.count();
  // Newest connection first: the one whose token we hold.
  await connections.first().getByRole("button", { name: "Revoke" }).click();
  await expect(connections).toHaveCount(before - 1);
  const after = await mcp(access, "get_product_context");
  expect(after.status, "revoked in SignalForge → Claude loses access at once").toBe(401);
  const reuse = await form("/api/oauth/token", { grant_type: "refresh_token", refresh_token: rotated.json.refresh_token!, client_id: client.client_id });
  expect(reuse.json.error).toBe("invalid_grant");

  // Reconnect, then Disconnect: every connection of this workspace stops working at once.
  const code3 = await getFreshCode();
  const t3 = await form("/api/oauth/token", { grant_type: "authorization_code", code: code3, client_id: client.client_id, redirect_uri: CALLBACK, code_verifier: verifier });
  expect((await mcp(t3.json.access_token!, "get_product_context")).status).toBe(200);
  await page.goto("/settings/agent");
  await expect(main.getByTestId("claude-state")).toHaveText("Connected");
  await main.getByRole("button", { name: "Disconnect" }).first().click();
  await expect(main.getByTestId("claude-state")).toHaveText("Not connected");
  expect((await mcp(t3.json.access_token!, "get_product_context")).status, "disconnect revokes access").toBe(401);
});

test("OAuth consent: denial, foreign redirect URIs and unregistered clients", async ({ page }) => {
  await page.goto(await signInPath(user!.email, "/settings/agent"));
  const evil = await fetch(`${BASE}/api/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://evil.example/cb"] }) });
  expect(evil.status).toBe(400);
  expect(((await evil.json()) as { error: string }).error).toBe("invalid_redirect_uri");
  const reg = (await (await fetch(`${BASE}/api/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude (e2e)", redirect_uris: [CALLBACK] }) })).json()) as { client_id: string };
  const challenge = b64url(createHash("sha256").update(b64url(randomBytes(32))).digest());
  const base = { response_type: "code", client_id: reg.client_id, code_challenge: challenge, code_challenge_method: "S256", state: "xyz" };
  await page.goto(`/oauth/authorize?${new URLSearchParams({ ...base, redirect_uri: "https://evil.example/cb" })}`);
  await expect(page.getByText("didn't come from a registered Claude client")).toBeVisible();
  await page.goto(`/oauth/authorize?${new URLSearchParams({ ...base, redirect_uri: CALLBACK, client_id: "sfc_" + "x".repeat(30) })}`);
  await expect(page.getByText("didn't come from a registered Claude client")).toBeVisible();
  let redirected = "";
  await page.route(`${CALLBACK}**`, (r) => { redirected = r.request().url(); return r.fulfill({ status: 200, body: "ok" }); });
  await page.goto(`/oauth/authorize?${new URLSearchParams({ ...base, redirect_uri: CALLBACK })}`);
  await page.getByRole("button", { name: "Deny" }).click();
  await expect.poll(() => redirected).toContain("error=access_denied");
  expect(new URL(redirected).searchParams.get("state")).toBe("xyz");
  const grants = await adminSelect<unknown[]>(`oauth_grants?workspace_id=eq.${ids.workspaceId}&select=id`);
  expect(grants.length, "denying creates no grant").toBe(0);
});
