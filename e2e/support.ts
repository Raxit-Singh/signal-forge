// E2E helpers. Every test account is throwaway (sf-e2e-*@example.com), lives
// in its own workspace, and is deleted after the test. Fixture mentions are
// clearly synthetic and never written to a real customer's workspace.
import { randomUUID } from "node:crypto";

const URL_ = () => must("NEXT_PUBLIC_SUPABASE_URL");
const SECRET = () => must("SUPABASE_SECRET_KEY");
const PUBLISHABLE = () => must("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for e2e tests (loaded from .env.local)`);
  return v;
}

const adminHeaders = () => ({ apikey: SECRET(), Authorization: `Bearer ${SECRET()}`, "content-type": "application/json" });

async function call<T>(path: string, init: RequestInit & { headers: Record<string, string> }): Promise<T> {
  const res = await fetch(`${URL_()}${path}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path.split("?")[0]} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export interface TestUser {
  id: string;
  email: string;
  /** Session for REST calls as this user (RLS applies). */
  headers: Record<string, string>;
}

/** Unconfirmed account + the verification link the app would email. */
export async function createUnconfirmedUser(fixedEmail?: string): Promise<{ email: string; id: string; confirmPath: string }> {
  const email = fixedEmail ?? `sf-e2e-${Date.now()}-${randomUUID().slice(0, 6)}@example.com`;
  const g = await call<{ id?: string; user?: { id: string }; hashed_token?: string; properties?: { hashed_token: string } }>(
    "/auth/v1/admin/generate_link",
    { method: "POST", headers: adminHeaders(), body: JSON.stringify({ type: "signup", email, password: `${randomUUID()}Aa1!` }) },
  );
  const token = g.hashed_token ?? g.properties?.hashed_token;
  return { email, id: (g.id ?? g.user?.id)!, confirmPath: `/auth/confirm?token_hash=${token}&type=signup&next=/onboarding` };
}

/** One-time sign-in link (magic link) for an existing account. */
export async function signInPath(email: string, next: string): Promise<string> {
  const g = await call<{ hashed_token?: string; properties?: { hashed_token: string } }>("/auth/v1/admin/generate_link", {
    method: "POST", headers: adminHeaders(), body: JSON.stringify({ type: "magiclink", email }),
  });
  return `/auth/confirm?token_hash=${g.hashed_token ?? g.properties?.hashed_token}&type=email&next=${encodeURIComponent(next)}`;
}

/** Confirmed account with a REST session. */
export async function createUser(fixedEmail?: string): Promise<TestUser> {
  const u = await createUnconfirmedUser(fixedEmail);
  const token = new URL(`http://x${u.confirmPath}`).searchParams.get("token_hash");
  const v = await call<{ access_token: string; user: { id: string } }>("/auth/v1/verify", {
    method: "POST", headers: { apikey: PUBLISHABLE(), "content-type": "application/json" },
    body: JSON.stringify({ type: "signup", token_hash: token }),
  });
  return {
    id: v.user.id,
    email: u.email,
    headers: { apikey: PUBLISHABLE(), Authorization: `Bearer ${v.access_token}`, "content-type": "application/json", Prefer: "return=representation" },
  };
}

export async function createWorkspaceWithProduct(user: TestUser, product = "FixtureFlow") {
  const workspaceId = await call<string>("/rest/v1/rpc/create_workspace", {
    method: "POST", headers: user.headers, body: JSON.stringify({ p_name: "E2E Workspace" }),
  });
  const [p] = await call<Array<{ id: string }>>("/rest/v1/products", {
    method: "POST", headers: user.headers,
    body: JSON.stringify({ workspace_id: workspaceId, name: product, created_by: user.id, onboarding_step: 6 }),
  });
  await call("/rest/v1/rpc/replace_product_aliases", {
    method: "POST", headers: user.headers,
    body: JSON.stringify({ p_product_id: p!.id, p_aliases: [{ term: product, kind: "exact_name" }] }),
  });
  // What the app's keyword save does next (server-side planner): one search per free Milestone 2 source.
  await call("/rest/v1/rpc/svc_apply_query_groups", {
    method: "POST", headers: adminHeaders(),
    body: JSON.stringify({
      p_product_id: p!.id,
      p_groups: ["hackernews", "github", "stackexchange"].map((provider) => ({
        provider, stream: "default", query: product, params: { terms: [product], role: "brand" },
      })),
    }),
  });
  return { workspaceId, productId: p!.id };
}

export interface FixtureMention {
  source: "hackernews" | "github" | "stackexchange" | "bluesky" | "reddit";
  externalId: string;
  title: string;
  content?: string;
  hoursAgo: number;
  url?: string;
  author?: string;
  status?: "relevant" | "irrelevant" | "pending";
  type?: "post" | "comment" | "reply";
  linkedUrl?: string;
}

/** Inserts synthetic mentions through the same ingest path the worker uses, plus a coverage window. */
export async function seedMentions(productId: string, workspaceId: string, items: FixtureMention[], coverageDays = 30) {
  const now = Date.now();
  for (const source of ["hackernews", "github", "stackexchange", "bluesky", "reddit"] as const) {
    const batch = items.filter((i) => i.source === source).map((i) => ({
      external_id: i.externalId,
      source_url: i.url ?? `https://example.com/e2e/${source}/${i.externalId}`,
      title: i.title,
      content: i.content ?? null,
      published_at: new Date(now - i.hoursAgo * 3_600_000).toISOString(),
      engagement: { comments: 1 },
      engagement_score: 1,
      matched_terms: ["FixtureFlow"],
      relevance_score: 0.9,
      relevance_status: i.status ?? "relevant",
      author_external_id: i.author ?? null,
      mention_type: i.type ?? "post",
      linked_url: i.linkedUrl ?? null,
    }));
    if (batch.length === 0) continue;
    await call("/rest/v1/rpc/svc_ingest_mentions", {
      method: "POST", headers: adminHeaders(),
      body: JSON.stringify({ p_product_id: productId, p_source: source, p_items: batch }),
    });
    await call("/rest/v1/coverage_windows", {
      method: "POST", headers: adminHeaders(),
      body: JSON.stringify({
        workspace_id: workspaceId, product_id: productId, provider: source, status: "complete",
        window_start: new Date(now - coverageDays * 86_400_000).toISOString(), window_end: new Date(now).toISOString(),
      }),
    });
  }
}

export async function readMention(productId: string, externalId: string) {
  const rows = await call<Array<{ relevance_status: string }>>(
    `/rest/v1/mentions?product_id=eq.${productId}&external_id=eq.${encodeURIComponent(externalId)}&select=relevance_status`,
    { headers: adminHeaders() },
  );
  return rows[0];
}

/** Removes the account the same way the app's account deletion does. */
export async function deleteUser(id: string) {
  await call("/rest/v1/rpc/svc_prepare_account_deletion", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ p_user_id: id }) })
    .catch(() => undefined);
  await call(`/auth/v1/admin/users/${id}`, { method: "DELETE", headers: adminHeaders() }).catch(() => undefined);
}

/** Service-role insert (fixtures only, e.g. a stored spike). */
export async function adminInsert(table: string, row: Record<string, unknown>) {
  await call(`/rest/v1/${table}`, { method: "POST", headers: adminHeaders(), body: JSON.stringify(row) });
}

export async function adminSelect<T>(path: string): Promise<T> {
  return call<T>(`/rest/v1/${path}`, { headers: adminHeaders() });
}

/** Service-role update (fixtures only, e.g. moving a test workspace to another plan). */
export async function adminUpdate(path: string, patch: Record<string, unknown>) {
  await call(`/rest/v1/${path}`, { method: "PATCH", headers: adminHeaders(), body: JSON.stringify(patch) });
}
