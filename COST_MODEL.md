# Cost model

**Measured so far (2026-10-14, development only):** one 30-day initial scan of a popular product ("Excalidraw", 3 keywords, YouTube not configured) made **9 external API calls** (HN 3, Stack Exchange 3, GitHub 3), took ~10 s of worker time, and stored 292 mentions; a daily scheduled run is ~7 calls. All four sources are free, so API cost is $0; the binding limits are quotas (GitHub 10–30 searches/min, Stack Exchange 300 or 10,000/day, YouTube 100 searches/day per project). Ingestion counted against the plan's monthly mention limit as designed.

**Milestone 2.5/3 (2026-10-15): actual paid API spend is $0.** No API Direct key is configured, so no paid request has ever been made; all API Direct figures below are **estimates from published prices**. Free official sources added (Bluesky, DEV, App Store feed) cost $0. Measured on a live 30-day scan of "Excalidraw" with 2 keywords: 9 official-API calls across HN, GitHub, Stack Exchange, Bluesky and DEV; a scheduled Bluesky check is 1–3 calls.

**First live API Direct validation (2026-10-16, authorized cap $0.05):** 9 requests (Reddit posts, Reddit comments ×2 pages, X, LinkedIn, TikTok, Instagram, Facebook, Substack, Google web), all HTTP 200, 174 results. **Charged by the documented billing rules: $0.048** (recorded in `api_cost_ledger`, purpose `live_test`). **Provider-confirmed charge: not yet reconciled** — API Direct exposes no billing API; check its dashboard (each endpoint's first 50 requests a month are free, so the real charge may be $0). Details in API_LIMITATIONS.md.

**Everything else below is still an assumption or a published list price.** Nothing is deployed and no customer traffic exists, so every figure below is an assumption or a published list price (checked 2026-10-14). The admin cost dashboard (M6) will replace assumptions with measurements from `api_usage_events`, `ai_usage_records`, `job_runs` and database size.

## Fixed infrastructure

| Item | Dev / beta | Commercial launch | Source |
|---|---|---|---|
| Supabase | Free (500 MB DB, 50k MAU, 5 GB egress, pauses after 7 idle days) | **Pro, from US$25/mo** (no pausing; needed for reliable scheduled monitoring) | supabase.com/pricing |
| App hosting | Vercel Hobby, free — non-commercial use only | **Vercel Pro US$20/mo per developer seat**, or a host allowing commercial use on a free/cheap tier | vercel.com/docs/plans/hobby |
| Transactional email (auth + reports) | Supabase default sender (testing only) | Free tier of an SMTP provider is likely enough below ~1,000 customers — *assumption, choose in M6* | — |
| Domain | — | ~US$10–15/yr — *assumption* | — |
| Data source APIs (GitHub, HN, Stack Exchange, YouTube) | Free | Free at default quotas | API_LIMITATIONS.md |
| Stripe | — | Per-transaction fees only; no monthly fee — *verify current rates in M6* | — |

**Fixed baseline at launch ≈ US$45/month** (Supabase Pro + Vercel Pro), covered by one Pro subscription before variable costs.

## Subscription plans (2026-10-16)

Prices and limits live in the `plans` table (single source; the UI reads it). The old Starter ($9) and Business ($49) plans are retired (hidden, kept for referential integrity); Pro was repriced. No annual discounts; no payment integration yet (checkout shows "coming soon").

| | Free | Pro | Scale |
|---|---|---|---|
| Price | $0/month | $100/month | $300/month |
| Active keywords (per workspace) | 1 | 10 | 40 |
| Mentions / billing period | 100 | 15,000 | 50,000 |
| Fastest refresh (plan floor) | 24 h | 1 h | 1 h |
| Keyword refresh **target** | 7 days | 24 h | 6 h |
| Paid platforms | not included | included, subject to availability | included, subject to availability |
| Internal paid-API operating budget (not customer credit) | $0 | $25 / workspace / month | $75 / workspace / month |
| Scheduler priority | 0 | 1 | 2 |
| Products / history | 1 / 30 days | 3 / 365 days | 10 / 730 days |

**Margin sketch (paid API only):** Pro's $25 budget is 25 % of its price, Scale's $75 is 25 %. Infrastructure and AI (M4) come on top; the budgets are hard caps in Postgres, and pacing keeps spend inside them (below).

## Paid social data — API Direct (pay-as-you-go; estimates only)

Prices from apidirect.io/docs/pricing, verified 2026-10-15, stored in the `provider_pricing` table (the only place prices live; edit a row with a new `effective_from` to change one). They match the founder's initial list.

| Endpoint | Price | Billing |
|---|---|---|
| Reddit search posts | $0.003 | per request (≤20 posts/page) |
| Reddit search comments | $0.003 | **per page requested** |
| X search posts / tweet replies / quotes | $0.006 | per page requested |
| LinkedIn search posts | $0.006 | per request |
| TikTok search videos / video comments | $0.006 | per page requested |
| Instagram search posts / post comments | $0.006 | per page requested |
| Facebook search posts / post comments | $0.008 | per page requested |
| Substack search posts | $0.003 | per request |
| Substack search notes | $0.003 | per page |
| Google web search | $0.004 | per page (10 results) |
| Google News | $0.008 | per request (≤100 articles) |
| Trustpilot company reviews | $0.005 | per page (≤20 reviews) |

Zero-result answers are billed. Every account gets 50 free requests per endpoint per month (ignored in estimates — conservative).

**How often paid platforms are checked** is decided automatically (Smart Monitoring): each platform's activity score sets its interval, quiet paid platforms run one step slower, and **the plan's minimum interval is a hard floor** (Free 24 h, Pro and Scale 1 h). Then two plan rules apply (`src/lib/sources/entitlements.ts`):
1. **Keyword refresh target** (Free 7 days, Pro 24 h, Scale 6 h): a platform's interval is shortened so its slowest keyword (interval × rotation turns) meets the target, never below the plan floor or a source's own minimum (YouTube 24 h).
2. **Paid pacing:** if the projected spend to the end of the month at those intervals exceeds the product's share of the workspace's remaining paid budget, paid platforms are lengthened one step at a time (costliest first) until it fits.
Whatever target can't be met is stored (`platform_activity.keyword_conflict`) and shown on Smart Monitoring with the real interval — never silently exceeded or skipped. Searches per check on non-OR paid platforms (`plan_paid_allowances.max_searches_per_platform`): Free/Pro 2, Scale 4; rotation never exceeds it (the earlier 7-day guarantee that could add ~14 % extra searches is replaced by the plan targets). Paid collection also pauses while a workspace's mention allowance is used up.

**Per product, per check:** `npm run audit:keywords` prints the exact query groups, requests and estimated cost per platform from the stored keywords and `provider_pricing` (read-only). Estimates assume 2 pages per check (the default), no saturation, and comment expansion of 1 parent per run on X/TikTok/Instagram/Facebook (1–4 by activity score). Reddit counts both post and comment searches.

**Measured with the planner (2026-10-16):**

| Product / keywords | Paid searches per check (all 10 platforms) | If all 10 paid platforms ran daily |
|---|---|---|
| `octolens`, stored keywords (1: "starlink") | 12 | $2.76–3.90 / month |
| Same product, hypothetical 10 keywords (brand, domain, handle, 2 spellings, 2 brand phrases, 2 category terms, 1 competitor) | 23 (Reddit: 7 keywords → 2 groups × posts + comments; TikTok/Instagram/Facebook: 2 per check, 6 more taking turns) | $5.22–6.72 / month (**unchanged** by rotation; re-measured 2026-10-16) |
| `octolens`, stored keywords as of 2026-10-16 (2: "starlink", "wisprflow") | 17 | $4.05–5.28 / month (higher than the row above only because a keyword was added) |

**Per plan, with targets and pacing (estimated 2026-10-16 with the planner, one product using the workspace budget, 2 pages per page-billed search):**

| Plan / keywords | Unpaced projection | After pacing | Keyword target met? |
|---|---|---|---|
| Pro, 1 keyword, paid platforms at 6 h | $12.24 / month | $12.24 | yes |
| Pro, 10 keywords, activity 6 h | $36.00 | **$23.40** (budget $25) | no on non-OR platforms: TikTok/Instagram ~42 h, Facebook ~84 h, Substack ~28 h (shown as conflicts) |
| Pro, 10 keywords, quiet (24 h) | $26.64 | $24.72 | Facebook ~28 h (conflict); others yes |
| Scale, 10 keywords | $71.28 | $71.28 (budget $75) | yes (non-OR platforms every 2 h) |
| Scale, 40 keywords | $170.85 | **$73.01** | no on non-OR platforms (~39–78 h) |

So with many keywords, the paid budget — not the plan floor — decides how fresh non-OR paid platforms are. Raising a plan's budget or `max_searches_per_platform` is the lever; both are rows, not code. Saturated runs add a page per group; completeness audits add ~1 check/week/group (fortnightly on quiet paid platforms). Launch Boost spend is capped separately by its paid-check limit. Each endpoint's first 50 requests a month are free (ignored here — conservative). **No paid request has been made yet: these are estimates, not measurements.**

**Controls (enforced in Postgres before every paid call):** global monthly budget (no row ⇒ no paid calls), optional provider and platform budgets, each workspace's plan allowance (`plan_paid_allowances`: Free $0, Pro $25, Scale $75 — internal operating targets, not customer credits; retired Starter $1 / Business $20 rows kept), optional workspace/product budgets, and per-boost paid-check caps. Shared fetches split one request's cost across every product with the same query. API Direct's own account-level daily/monthly spending limits are a second line of defence (set them in its dashboard). Reconcile monthly: compare the API Direct invoice with `select sum(coalesce(charged_usd, estimated_usd)) from api_cost_ledger where period_start = '<month>' and status <> 'released'` and record it in `billing_reconciliations`.

## Variable costs (assumptions to validate in M2–M4)

| Driver | Assumption | Notes |
|---|---|---|
| Mentions stored | ~2 KB/row incl. indexes and classification history | 500 MB ≈ 250k mentions. Retention (plan `history_days`) caps growth. |
| Monitoring jobs | Per product per run: ≤5 HN + ≤5 Stack Exchange + 1 GitHub + 1 YouTube search (+≤6 YouTube units) | Measured ~7 calls/run with 3 keywords. Free runs daily; Pro/Scale as often as hourly (activity- and target-driven). |
| Shared quotas (not money) | GitHub 30 searches/min with a token ≈ 43k/day; Stack Exchange 10k/day with a key; **YouTube 100 searches/day total** | Daily-per-product cost: HN ≤5, SE ≤5, GH 1, YT 1. Stack Exchange binds at ~1,800 product-runs/day; **YouTube binds at ~95 products** until a (free) quota extension is approved. |
| AI classification (SignalForge credits) | Only mentions that pass deterministic filters and dedup reach a model; cheap model first; cached by content hash | Per-mention token counts and model prices will be **measured** in M4 before plan budgets are finalised. BYOK workspaces cost SignalForge nothing for AI. |
| Deep analysis / investigations | On demand, capped per plan (`monthly_investigations`) | Largest per-call cost; hard monthly cap per workspace. |

## Scenarios (shape, not forecast)

| Customers | Infra tier | Fixed / month | What to watch |
|---|---|---|---|
| 10 | Supabase Pro + Vercel Pro | ~US$45 | Nothing; well inside quotas. |
| 100 | Same | ~US$45 + AI usage | **YouTube: exceeds 100 searches/day** if every product monitors YouTube → apply for quota extension before ~90 products; searches queue (deferred) meanwhile. DB size vs retention. |
| 500 | Same; possibly Supabase compute add-on | ~US$45–100 + AI usage | YouTube quota extension needed; GitHub search rate (30/min) → stagger runs; email volume. |
| 1,000 | Supabase Pro with larger compute/storage | ~US$100–200 + AI usage | DB may exceed Pro's included disk → storage overage; consider moving cold mentions to aggregated-only. |

AI usage is deliberately left out of totals until M4 measures tokens per mention; plan budgets (`monthly_ai_token_budget`) are hard caps, so AI spend per workspace is bounded by configuration.

## Founder decisions needed (will ask before acting)
0. **API Direct:** ✅ account, provider spending limit (confirmed by the founder) and a capped live test ($0.048 of $0.05) done 2026-10-16. Still open: reconcile the test against the API Direct dashboard, and choose a **global monthly budget** (`api_budgets` scope `global`) before enabling paid monitoring (`PAID_SOURCES_ENABLED=true`).
0b. **Paid budgets per plan** (Pro $25, Scale $75) and searches per check without OR (Free/Pro 2, Scale 4): with 10+ keywords these, not the plan floor, set how fresh TikTok/Instagram/Facebook/Substack are (table above).
1. Supabase Pro at first paying customer (US$25/mo).
2. Vercel Pro vs. an alternative host before charging customers (US$20/mo).
3. Which AI provider/model backs SignalForge credits, and per-plan token budgets (M4).
4. Stripe account setup (M6).
