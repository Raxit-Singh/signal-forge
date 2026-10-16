# Cost model

**Measured so far (2026-10-14, development only):** one 30-day initial scan of a popular product ("Excalidraw", 3 keywords, YouTube not configured) made **9 external API calls** (HN 3, Stack Exchange 3, GitHub 3), took ~10 s of worker time, and stored 292 mentions; a daily scheduled run is ~7 calls. All four sources are free, so API cost is $0; the binding limits are quotas (GitHub 10–30 searches/min, Stack Exchange 300 or 10,000/day, YouTube 100 searches/day per project). Ingestion counted against the plan's monthly mention limit as designed.

**Milestone 2.5/3 (2026-10-15): actual paid API spend is $0.** No API Direct key is configured, so no paid request has ever been made; all API Direct figures below are **estimates from published prices**. Free official sources added (Bluesky, DEV, App Store feed) cost $0. Measured on a live 30-day scan of "Excalidraw" with 2 keywords: 9 official-API calls across HN, GitHub, Stack Exchange, Bluesky and DEV; a scheduled Bluesky check is 1–3 calls.

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

**Fixed baseline at launch ≈ US$45/month** (Supabase Pro + Vercel Pro). On the proposed prices that is covered by ~3 Pro or ~5 Starter subscribers before variable costs.

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

**How often paid platforms are checked** is decided automatically (Smart Monitoring, 2026-10-16): each platform's activity score sets its interval, quiet paid platforms run one step slower, and **the plan's minimum interval is a hard floor** (Free/Starter 24 h, Pro 6 h, Business 3 h). So the plan bounds the worst case; activity only decides how close a platform gets to it. The former Eco/Balanced/Priority modes are gone; their one cost lever that remains is `plan_paid_allowances.max_searches_per_platform` — searches per check on paid platforms that can't OR-combine keywords (TikTok, Instagram, Facebook, Substack) — default **2**. Since 2026-10-16 this budget no longer drops keywords: the rest **take turns** (each searched every few checks), so cost per check stays at the budget while every keyword is covered, except where the **7-day coverage guarantee** forces extra searches (e.g. 9 rotating keywords on a daily plan: 1 + 9/7 ≈ 2.3 searches per check instead of 2, about +14 % on those platforms).

**Per product, per check:** `npm run audit:keywords` prints the exact query groups, requests and estimated cost per platform from the stored keywords and `provider_pricing` (read-only). Estimates assume 2 pages per check (the default), no saturation, and comment expansion of 1 parent per run on X/TikTok/Instagram/Facebook (1–4 by activity score). Reddit counts both post and comment searches.

**Measured with the planner (2026-10-16):**

| Product / keywords | Paid searches per check (all 10 platforms) | If all 10 paid platforms ran daily (Free/Starter floor) |
|---|---|---|
| `octolens`, stored keywords (1: "starlink") | 12 | $2.76–3.90 / month |
| Same product, hypothetical 10 keywords (brand, domain, handle, 2 spellings, 2 brand phrases, 2 category terms, 1 competitor) | 23 (Reddit: 7 keywords → 2 groups × posts + comments; TikTok/Instagram/Facebook: 2 per check, 6 more taking turns) | $5.22–6.72 / month (**unchanged** by rotation; re-measured 2026-10-16) |
| `octolens`, stored keywords as of 2026-10-16 (2: "starlink", "wisprflow") | 17 | $4.05–5.28 / month (higher than the row above only because a keyword was added) |

At a 6 h interval multiply by 4, at 3 h by 8 (e.g. the 10-keyword product on Business with every paid platform busy enough for its 3 h floor: about $42–54 / month) — the plan's paid allowance caps actual spend either way. Saturated runs add a page per group; completeness audits add ~1 check/week/group (fortnightly on quiet paid platforms). Launch Boost spend is capped separately by its paid-check limit. Each endpoint's first 50 requests a month are free (ignored here — conservative). **No paid request has been made yet: these are estimates, not measurements.**

**Controls (enforced in Postgres before every paid call):** global monthly budget (no row ⇒ no paid calls), optional provider and platform budgets, each workspace's plan allowance (`plan_paid_allowances`, proposed: Free $0, Starter $1, Pro $5, Business $20 — **founder decision**), optional workspace/product budgets, and per-boost paid-check caps. Shared fetches split one request's cost across every product with the same query. API Direct's own account-level daily/monthly spending limits are a second line of defence (set them in its dashboard). Reconcile monthly: compare the API Direct invoice with `select sum(coalesce(charged_usd, estimated_usd)) from api_cost_ledger where period_start = '<month>' and status <> 'released'` and record it in `billing_reconciliations`.

## Variable costs (assumptions to validate in M2–M4)

| Driver | Assumption | Notes |
|---|---|---|
| Mentions stored | ~2 KB/row incl. indexes and classification history | 500 MB ≈ 250k mentions. Retention (plan `history_days`) caps growth. |
| Monitoring jobs | Per product per run: ≤5 HN + ≤5 Stack Exchange + 1 GitHub + 1 YouTube search (+≤6 YouTube units) | Measured ~7 calls/run with 3 keywords. Free plan runs daily; Business every 3 h. |
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
0. **API Direct:** create the account, set its spending limits, decide the global monthly budget and per-plan paid allowances, and authorize a capped live test (`npm run test:apidirect-live -- --confirm --max-usd 0.05`).
0b. **Searches per check on paid platforms without OR** (`plan_paid_allowances.max_searches_per_platform`, default 2 for every plan). Every keyword is now searched (rotation); raising it per plan shortens how long rotating keywords wait, at proportionally higher cost.
1. Supabase Pro at first paying customer (US$25/mo).
2. Vercel Pro vs. an alternative host before charging customers (US$20/mo).
3. Which AI provider/model backs SignalForge credits, and per-plan token budgets (M4).
4. Stripe account setup (M6).
