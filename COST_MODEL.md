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

**Per product, per check (optimizer keeps OR-capable platforms to one query; one page unless a run was saturated):**

| Setup | Search cost/check | + comment expansion (balanced: ≤2 parents × 1 page) |
|---|---|---|
| Reddit (posts + comments) + X | $0.012 | X replies ≤ $0.012 |
| All 10 paid platforms | $0.061 | ≤ $0.052 (X, TikTok, Instagram, Facebook) |

**Monthly, one product (30 days), estimates:**

| Mode / typical interval | Reddit + X | All 10 platforms |
|---|---|---|
| Eco, quiet product (24 h) | $0.36–0.72 | $1.8–3.4 |
| Balanced (12 h) | $0.72–1.44 | $3.7–6.8 |
| Priority, busy product (1–2 h) | $4.3–17 | $22–81 |

Upper bounds assume expansion on every run; saturated runs add a page (×1 per extra page). Completeness audits add ~1 check/week/group. Launch Boost spend is capped separately by its paid-check limit.

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
1. Supabase Pro at first paying customer (US$25/mo).
2. Vercel Pro vs. an alternative host before charging customers (US$20/mo).
3. Which AI provider/model backs SignalForge credits, and per-plan token budgets (M4).
4. Stripe account setup (M6).
