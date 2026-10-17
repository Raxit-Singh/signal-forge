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

**How often paid platforms are checked** is decided automatically (Smart Monitoring, **arrival-rate engine V2 since 2026-10-16** — see "Discovery Engine V2 simulation" below): each search's measured arrival rate sets a freshness interval and a brand-safe bound, quiet platforms are explored at their ceiling, and **the plan's minimum interval is a hard floor** (Free 24 h, Pro and Scale 1 h). Then two plan rules apply (`src/lib/sources/entitlements.ts`):
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

### Pro / Scale budget simulation (2026-10-16, `node scripts/simulate-plan-costs.ts`)

Read-only model on the production planner (OR groups, Reddit posts + comments streams, rotation, plan targets) with the live-observed page sizes, each endpoint's billing (page-loop endpoints pay for pages fetched; `pages=N` endpoints pay for every requested page, results or not), saturation (+1 page up to the platform cap), comment expansion on X/TikTok/Instagram/Facebook (`expansionsPerRun` parents per check), and pacing with interval-dependent cost. **Volumes are assumptions** (per keyword per day, e.g. a category phrase ≈ 80 X posts, 40 Reddit comments; brand terms ≈ 4 X posts; "quiet"/"typical"/"busy" brand = ×0.5/×1/×10 at 24 h/6 h/2 h activity). Configurations: 10 keywords (name, domain, handle, variant, 2 covered brand phrases, 2 category phrases, 2 competitors) and 40 (6 brand terms, 6 covered phrases, 14 category, 10 competitors, 4 feature phrases).

| Plan · budget | 10 kw quiet | 10 kw typical | 10 kw busy | 40 kw (quiet / typical / busy) |
|---|---|---|---|---|
| Pro $25 | $23.91 ✅ targets met | $24.48 (unpaced $34.08) ✅ TikTok/Facebook 42 h, Substack 28 h | $24.06 ❌ TikTok 84 h, Facebook 168 h, X brand searches saturate | — |
| Pro $35 | $23.91 ✅ | **$34.08 ✅ all targets met** | $34.92 ❌ TikTok 42 h, Facebook 84 h, X brand saturation | — |
| Scale $75 | $64.32 ✅ | $65.04 ✅ | $74.96 ✅ TikTok/Facebook 9 h (target 6 h) | $72–74 ❌ non-OR platforms 22–132 h |
| Scale $100 | $64.32 ✅ | $65.04 ✅ | $89.76 ✅ all met | $95–99 ❌ non-OR platforms 22–66 h |

✅ = acceptable: spend ≤ budget, target met on OR platforms, every platform within 2× target, no brand search saturated. Reddit comments are $0.45–8.64/month of these totals; comment expansion $0.18–15.84.

**Findings:**
- **Pro $35** fully meets the 24 h target for a typical 10-keyword product (vs 28–42 h on non-OR platforms at $25); a busy product still misses at either budget. **Scale $100** only changes the busy 10-keyword case; **40 keywords miss the 6 h target at both $75 and $100** because TikTok, Instagram, Facebook and Substack need one search per keyword (34 searches each, 68 on Substack) — the budget isn't the lever there.
- **Page right-sizing saves ~30 %:** the monitor requests 2 pages by default on `pages=N` endpoints and is billed for both even when one page holds every result (quiet Pro: $23.91 → $15.54; typical Scale: $65.04 → $42.96).
- **Pacing can cause misses:** lengthening the costliest platform first pushed X to 12 h for a busy product, where brand searches overflow the 3-page cap — those mentions would be missed, not just delayed.
- **Decision (not activated):** internal budgets stay **Pro $25 / Scale $75**. Pro $35 is justified for typical products; Scale $100 is not justified by freshness for 40 keywords. Recommended before raising budgets: right-size pages, make pacing avoid brand saturation (pace category/rotating searches first), and decide whether Scale's 6 h target should apply to non-OR paid platforms or only to brand keywords there.

### Discovery Engine V2 simulation (2026-10-16, `node scripts/simulate-plan-costs.ts`; `--v1` = previous engine)

What changed in the model (all as implemented): intervals from arrival rates (`decidePlatformIntervalV2`) instead of activity scores; **page right-sizing** (`pages=N` endpoints request the pages the arrival rate needs, one escalation if a page set overflows); **continuation jobs** for date-range sources (X, Facebook, Bluesky, HN, GitHub, Stack Overflow) and page offsets (Reddit posts, LinkedIn, Substack posts) instead of losing overflow; **brand-safe pacing** (`paceForBudgetSafely` never lengthens a platform past the interval at which its results would overflow — when the budget can't cover that, spend is reported "over" and the refused share is counted as not found); rotating searches at overflow risk get out-of-turn checks. Volumes and relevance shares are **assumptions** (brand 85 % relevant, category 25 %, competitor 30 %; ranked searches assumed 70 % recall). Profiles: small (brand ×0.3), growing (×1), popular (×10), broad brand keyword (×150 volume, 8 % relevant — a common-word name), quiet platforms (brand ×0.05, category ×0.1), high-volume platforms (category/competitor ×3). "found" = expected relevant mentions per month on paid platforms only.

| Plan · budget · keywords | small | growing | popular | broad brand keyword | quiet platforms | high-volume platforms |
|---|---|---|---|---|---|---|
| Pro $25 · 10 | $23.94 ✅ 4.7k found | $24.12 ✅ 5.4k | $24.55 ✅ 14.6k (97 % of allowance); TikTok 28 h, IG/FB/Substack 42 h | $90.85 needed ❌ 27 % complete | $18.75 ✅ | $23.86 ❌ TikTok/FB 84 h, IG/Substack 168 h |
| Pro $35 · 10 | $31.86 ✅ | $31.86 ✅ | $33.69 ✅ all targets met | $90.85 needed ❌ 38 % | $18.75 ✅ | $34.68 ✅ IG 28 h, FB/Substack 42 h |
| Scale $75 · 10 | $65.64 ✅ | $65.64 ✅ | $67.80 ✅ | $92.28 needed ❌ 80 % | $40.80 ✅ | $70.32 ✅ |
| Scale $100 · 10 | $78.60 ✅ | $78.60 ✅ | $90.84 ✅ | $99.56 ❌ TikTok 12 h, IG/FB/Substack 18 h | $40.80 ✅ | $93.00 ✅ |
| Scale $75 · 40 | $74.80 ❌ X/LinkedIn 24 h, TikTok 33 h, IG/Substack 264 h | $73.52 ❌ | $73.49 ❌ (97 % of allowance) | $209.74 needed ❌ 35 % | $72.72 ❌ | $160.70 needed ❌ 46 % |
| Scale $100 · 40 | $99.22 ❌ X 24 h, TikTok/IG/FB/Substack 22–33 h | $99.40 ❌ | $99.15 ❌ | $209.74 needed ❌ 47 % | $92.76 ❌ | $160.70 needed ❌ 61 %, over allowance |

✅ = within budget, plan target met on OR platforms, every platform within 2× its target, no brand search overflowing. Within budget, expected completeness is ~98 % in every scenario (the 2 % is ranked-search recall): **overflow is no longer a loss** — it costs continuation pages instead. Reddit comments $0.72–20.52/month; comment expansion $0.36–8.64.

**Historical backfill (one-off, paid platforms):** 10 keywords: 30 days ≈ $3.70–9.86, 1 year ≈ $33–92 (broad brand keyword: $31 / $318); 40 keywords: 30 days ≈ $27–72, 1 year ≈ $247–683. Provider depth caps what's reachable (LinkedIn 30 days, TikTok 180 days, Reddit posts / Substack / web / news / Trustpilot 12 months, Reddit comments and Substack notes newest only, Instagram a ranked sample). A 1-year backfill for a popular 10-keyword product would find ~88k relevant mentions — far beyond Pro's 15,000 allowance: the historical-search warning and the allowance pause exist for exactly this.

**Compared with the previous engine (V1, same assumptions):** Pro $25 typical — V1 $24.48 with TikTok/Facebook 42 h and Substack 28 h, V2 $24.12 with every target met; Pro $25 busy — V1 failed (TikTok 84 h, Facebook 168 h, X brand searches overflowing their 3-page cap), V2 passes at 28–42 h with nothing lost; Pro $35 busy — V1 failed, V2 meets every target. Scale 40 keywords fails under both: V1 by losing overflow (6–9 saturated searches per check), V2 by refusing to slow overflowing searches and therefore starving rotation platforms (Instagram/Substack up to 264 h at $75).

**Findings and decision (budgets NOT changed — Pro $25, Scale $75 stay):**
- Right-sizing and continuations make **Pro $25 sufficient for small, growing and popular 10-keyword products**; Pro $35 adds headroom only for "high-volume platforms" (the one Pro case that fails at $25).
- **Scale $75 covers every 10-keyword case except a broad brand keyword.** Scale $100 doesn't fix 40 keywords (X needs ~24 h, rotation platforms 22–33 h vs the 6 h target): the levers are searches per check on non-OR platforms (`max_searches_per_platform`) and whether the 6 h target should apply to non-OR paid platforms.
- **A broad brand keyword exceeds every budget** (it would need $90–210/month): the onboarding/keyword warnings and the mention allowance are the controls; the dashboard shows the coverage shortfall instead of slowing the brand search.
- Cost is budget-bound whenever there is real activity: the engine spends the budget on freshness, so these totals track the budget, not volume. **Simulations are estimates, not measured production costs.**

**Controls (enforced in Postgres before every paid call):** global monthly budget (no row ⇒ no paid calls), optional provider and platform budgets, each workspace's plan allowance (`plan_paid_allowances`: Free $0, Pro $25, Scale $75 — internal operating targets, not customer credits; retired Starter $1 / Business $20 rows kept), optional workspace/product budgets, and per-boost paid-check caps. Shared fetches split one request's cost across every product with the same query. API Direct's own account-level daily/monthly spending limits are a second line of defence (set them in its dashboard). Reconcile monthly: compare the API Direct invoice with `select sum(coalesce(charged_usd, estimated_usd)) from api_cost_ledger where period_start = '<month>' and status <> 'released'` and record it in `billing_reconciliations`.

## SignalForge Intelligence — Gemini (estimates from assumptions; no live calls yet)

Prices: Gemini API paid tier, ai.google.dev pricing page dated 2026-10-16. `gemini-3.1-flash-lite` $0.25 in / $1.50 out; `gemini-embedding-2` $0.20 in; `gemini-3.8-flash` $0.75 / $3.75 (doubling on 2027-01-01).

| Work | Assumptions | Estimate |
|---|---|---|
| Classification (flash-lite, batches of 20) | ~3,500 input + ~2,200 output tokens per batch (thinking tokens, if any, add to output) | ≈ $0.21 per 1,000 mentions; ≈ 285k tokens |
| Embeddings (feedback only) | ~100 tokens per post | ≈ $0.02 per 1,000 posts |
| Merge checks | ≤ 40 pairs, ≤ 1 round per product per 6 h, cached | ≤ ≈ $0.008 per round; ≤ ≈ $1/month per active product |
| Pro at its full 15,000 mentions | as above | ≈ $4–5 / month; ≈ 6M of the plan's 8M tokens |
| Scale at its full 50,000 mentions | as above | ≈ $13–15 / month; ≈ 20M of the plan's 30M tokens |
| Spike explanation / issue summary | ≤ 40 posts ≈ 16k input + ~2k output | ≈ $0.007 on flash-lite, ≈ $0.02 on 3.8 flash |

- Every call is reserved at its upper bound and settled at reported usage; embeddings are settled at an estimate (Gemini returns no token count for them).
- Cached results cost nothing. Invalid answers and refusals still bill the tokens the provider reports.
- Neither the operator global limit (`ai_global_budget`) nor `SIGNALFORGE_AI_ENABLED=true` has been set: nothing has been spent.
- The developer agent costs SignalForge nothing in model usage: routines bill the customer's Claude subscription.

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
