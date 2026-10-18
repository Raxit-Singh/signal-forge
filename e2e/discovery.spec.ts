import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  adminInsert, adminSelect, createUser, createWorkspaceWithProduct, deleteUser, seedMentions, signInPath, type FixtureMention, type TestUser,
} from "./support";

// Discovery Engine V2 in the browser: realtime updates, the new-mentions notice,
// historical search progress, overflow risk and spike confidence. Synthetic
// fixtures only; no data source is ever called (nothing here starts a search).

let user: TestUser | null = null;
let other: TestUser | null = null;
let ids = { workspaceId: "", productId: "" };

const FIXTURES: FixtureMention[] = Array.from({ length: 25 }, (_, i) => ({
  source: "hackernews" as const, externalId: `e2e-rt-${i}`, title: `FixtureFlow realtime post ${i}`, hoursAgo: i + 1,
}));

const SB = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const adminHeaders = () => ({ apikey: process.env.SUPABASE_SECRET_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY!}`, "content-type": "application/json" });

/** What a monitoring job does when it finishes: store mentions, then emit one workspace event. */
async function workerStores(title: string, externalId: string) {
  const ingest = await fetch(`${SB()}/rest/v1/rpc/svc_ingest_mentions`, {
    method: "POST", headers: adminHeaders(),
    body: JSON.stringify({
      p_product_id: ids.productId, p_source: "hackernews",
      p_items: [{
        external_id: externalId, source_url: `https://example.com/e2e/rt/${externalId}`, title, published_at: new Date().toISOString(),
        engagement: {}, engagement_score: 0, matched_terms: ["FixtureFlow"], relevance_score: 0.9, relevance_status: "relevant", mention_type: "post",
      }],
    }),
  });
  expect(ingest.ok).toBe(true);
  await emit(ids.workspaceId, ids.productId, "mentions");
}

async function emit(workspaceId: string, productId: string | null, kind: string) {
  const r = await fetch(`${SB()}/rest/v1/rpc/svc_emit_workspace_event`, {
    method: "POST", headers: adminHeaders(),
    body: JSON.stringify({ p_workspace_id: workspaceId, p_product_id: productId, p_kind: kind, p_payload: { inserted: 1 } }),
  });
  expect(r.ok).toBe(true);
}

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

const items = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Mentions" }).getByRole("listitem");

test("realtime: new mentions appear on page 1 without a reload; older pages show a notice instead", async ({ page }) => {
  await page.goto(await signInPath(user!.email, "/mentions"));
  await expect(page).toHaveURL(/\/mentions$/);
  await expect(page.getByTestId("live-indicator")).toHaveAttribute("data-status", "live", { timeout: 20_000 });
  await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });
  // Past the first-connect catch-up refresh, so what follows can only come from the realtime event.
  await page.waitForTimeout(3500);

  await workerStores("FixtureFlow brand-new launch thread", "e2e-rt-new-1");
  await expect(items(page).first().locator("h3")).toHaveText("FixtureFlow brand-new launch thread", { timeout: 15_000 });
  await expect(page.getByText("Showing 1–20 of 26 mentions")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true); // refreshed in place, no full reload

  // On page 2 the list stays put; a notice offers the newest page, keeping filters.
  await page.goto("/mentions?source=hackernews&page=2");
  await expect(page.getByTestId("live-indicator")).toHaveAttribute("data-status", "live", { timeout: 20_000 });
  const before = await items(page).locator("h3").allInnerTexts();
  await workerStores("FixtureFlow second new thread", "e2e-rt-new-2");
  const notice = page.getByTestId("new-mentions-notice");
  await expect(notice).toContainText("1 new mention found", { timeout: 15_000 });
  expect(await items(page).locator("h3").allInnerTexts()).toEqual(before);
  await notice.getByRole("button", { name: "View latest" }).click();
  await expect(page).toHaveURL(/\/mentions\?source=hackernews$/);
  await expect(items(page).first().locator("h3")).toHaveText("FixtureFlow second new thread");
});

test("realtime is workspace-isolated: another workspace's subscriber never receives these events", async () => {
  other = await createUser();
  const otherWs = await createWorkspaceWithProduct(other, "OtherFlow");
  const listen = async (u: TestUser, workspaceId: string) => {
    const token = u.headers.Authorization!.slice("Bearer ".length);
    const client = createClient(SB(), process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { global: { headers: { Authorization: `Bearer ${token}` } } });
    await client.realtime.setAuth(token);
    const got: string[] = [];
    await new Promise<void>((resolve, reject) => {
      client.channel(`t-${workspaceId}-${u.id}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "workspace_events", filter: `workspace_id=eq.${workspaceId}` },
          (m) => got.push(String((m.new as { kind: string }).kind)))
        .subscribe((s) => (s === "SUBSCRIBED" ? resolve() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? reject(new Error(s)) : undefined));
    });
    return { client, got };
  };
  const owner = await listen(user!, ids.workspaceId);
  // The other user subscribes to THIS workspace's events (a filter they choose): RLS must deliver nothing.
  const intruder = await listen(other, ids.workspaceId);
  const own = await listen(other, otherWs.workspaceId);
  await emit(ids.workspaceId, ids.productId, "mentions");
  await emit(otherWs.workspaceId, otherWs.productId, "backfill");
  await expect.poll(() => owner.got.length, { timeout: 15_000 }).toBe(1);
  await expect.poll(() => own.got.length, { timeout: 15_000 }).toBe(1);
  await new Promise((r) => setTimeout(r, 2000));
  expect(intruder.got).toEqual([]);
  expect(owner.got).toEqual(["mentions"]);
  for (const c of [owner, intruder, own]) await c.client.removeAllChannels();
});

test("historical search progress: real states per platform, provider limits, no fake percentages", async ({ page }) => {
  const runId = crypto.randomUUID();
  const start = new Date(Date.now() - 30 * 86_400_000).toISOString();
  await adminInsert("backfill_runs", {
    id: runId, workspace_id: ids.workspaceId, product_id: ids.productId, mode: "30d", range_start: start, range_end: new Date().toISOString(), status: "searching",
  });
  const task = (platform: string, status: string, extra: Record<string, unknown> = {}) => adminInsert("backfill_tasks", {
    run_id: runId, workspace_id: ids.workspaceId, product_id: ids.productId, platform, stream: "default", status, ...extra,
  });
  await task("hackernews", "searching", { inserted: 42, cursor: { since: start, until: new Date(Date.now() - 12 * 86_400_000).toISOString() } });
  await task("github", "completed", { inserted: 7, completed_at: new Date().toISOString() });
  await task("stackexchange", "partial", { inserted: 3, note: "Stack Overflow kept returning the same results; the rest of this window could not be reached.", completed_at: new Date().toISOString() });
  await task("linkedin", "unavailable", { supported_since: new Date(Date.now() - 30 * 86_400_000).toISOString(), note: "Not available on this server: API_DIRECT_API_KEY is not set on the server." });

  await page.goto(await signInPath(user!.email, "/monitoring"));
  const progress = page.getByTestId("backfill-progress");
  await expect(progress).toContainText("Historical search");
  await expect(progress).toContainText("52 mentions collected");
  await expect(progress).toContainText("3 of 4 platforms finished");
  await expect(progress).toContainText("Searching");
  await expect(progress).toContainText("Reached back to");
  await expect(progress).toContainText("Partially collected");
  await expect(progress).toContainText("Completed");
  await expect(progress).toContainText("Unavailable");
  await expect(progress).toContainText("could not be reached");
  await expect(progress).not.toContainText("%");

  // A step finishing elsewhere updates the page live.
  await expect(page.getByTestId("live-indicator")).toHaveAttribute("data-status", "live", { timeout: 20_000 });
  await fetch(`${SB()}/rest/v1/backfill_tasks?run_id=eq.${runId}&platform=eq.hackernews`, {
    method: "PATCH", headers: adminHeaders(), body: JSON.stringify({ status: "completed", inserted: 60, cursor: null, completed_at: new Date().toISOString() }),
  });
  await fetch(`${SB()}/rest/v1/backfill_runs?id=eq.${runId}`, { method: "PATCH", headers: adminHeaders(), body: JSON.stringify({ status: "partial" }) });
  await emit(ids.workspaceId, ids.productId, "backfill");
  await expect(progress).toContainText("70 mentions collected", { timeout: 15_000 });
  await expect(progress).toContainText("4 of 4 platforms finished");
});

test("smart monitoring shows product-relative share and overflow risk; buzz shows spike confidence", async ({ page }) => {
  await adminInsert("platform_activity", {
    product_id: ids.productId, workspace_id: ids.workspaceId, platform: "hackernews", phase: "ranked", score: 64, rank: 1,
    trend: "stable", coverage_confidence: "high", recommended_interval: 1440, interval_minutes: 1440, reasons: ["Busy search: checked within 1 h so results don't overflow what one check can read"],
    importance_share: 0.64, arrival_per_day: 40, rate_upper_per_hour: 30, safe_interval_minutes: 300, collection_risk: "unavoidable",
    risk_detail: "More results arrive than one check can read even at the fastest allowed interval (24 h); some may be missed and coverage is marked partial.",
    model: "arrival_v2", mentions_7d: 25,
  });
  await page.goto(await signInPath(user!.email, "/monitoring"));
  const adv = page.locator("details#advanced");
  await adv.locator("summary").first().click();
  const hn = page.getByRole("table", { name: "Platform ranking" }).getByRole("row").filter({ hasText: "Hacker News" });
  await expect(hn).toContainText("64%");
  await hn.getByRole("button", { name: "Hacker News" }).click();
  const details = page.locator("#details-hackernews");
  await expect(details).toContainText("More than checks can read");
  await expect(details).toContainText("some may be missed and coverage is marked partial");
  await expect(details).toContainText("About 40 relevant mentions a day here");

  const day = (n: number) => new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000 - n * 86_400_000).toISOString();
  await adminInsert("buzz_spikes", {
    workspace_id: ids.workspaceId, product_id: ids.productId, platform: null, granularity: "day", period_start: day(2), period_end: day(1),
    observed: 30, expected: 4, baseline_periods: 20, robust_z: 9, ratio: 7.5, severity: "major", confidence: "confirmed", p_value: 1e-9,
  });
  await adminInsert("buzz_spikes", {
    workspace_id: ids.workspaceId, product_id: ids.productId, platform: "hackernews", granularity: "day", period_start: day(1), period_end: day(0),
    observed: 18, expected: 3, baseline_periods: 4, robust_z: 5, ratio: 6, severity: "notable", confidence: "possible", p_value: 1e-5,
    note: "This period was only partly monitored, so the count may be incomplete.",
  });
  await adminInsert("buzz_keyword_spikes", {
    workspace_id: ids.workspaceId, product_id: ids.productId, keyword: "fixtureflow", granularity: "day", period_start: day(2), period_end: day(1),
    observed: 22, expected: 2, baseline_periods: 20, severity: "major", confidence: "confirmed",
  });
  await adminInsert("spike_evaluations", {
    product_id: ids.productId, workspace_id: ids.workspaceId, scope: "product", scope_key: "", granularity: "day",
    status: "insufficient_data", baseline_periods: 2, needed_periods: 3,
  });
  await page.goto("/buzz?range=30d");
  // All activity: the confirmed product spike. Hacker News: its possible spike. Keyword: the keyword spike.
  await expect(page.getByTestId("spike-marker-confirmed")).toHaveCount(1);
  await page.getByTestId("spike-marker-confirmed").click();
  await expect(page.getByRole("dialog", { name: "Confirmed spike" })).toContainText("Major");
  await page.keyboard.press("Escape");
  await page.getByLabel("Show", { exact: true }).selectOption("platform:hackernews");
  await expect(page.getByTestId("spike-marker-possible")).toHaveCount(1);
  await page.getByTestId("spike-marker-possible").click();
  await expect(page.getByRole("dialog", { name: "Possible spike" })).toContainText("only partly monitored");
  await page.keyboard.press("Escape");
  await page.getByLabel("Show", { exact: true }).selectOption("keyword:FixtureFlow");
  await expect(page.getByTestId("spike-marker-confirmed")).toHaveCount(1);
  await page.getByTestId("spike-marker-confirmed").click();
  await expect(page.getByRole("dialog", { name: "Confirmed spike" })).toContainText("Keyword “fixtureflow”");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("spike-insufficient")).toContainText("2 of 3 completely monitored days");
  expect((await adminSelect<unknown[]>(`buzz_spikes?product_id=eq.${ids.productId}&select=id`)).length).toBe(2);
});
