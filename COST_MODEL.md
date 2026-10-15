# Cost model

**Measured so far (2026-10-14, development only):** one 30-day initial scan of a popular product ("Excalidraw", 3 keywords, YouTube not configured) made **9 external API calls** (HN 3, Stack Exchange 3, GitHub 3), took ~10 s of worker time, and stored 292 mentions; a daily scheduled run is ~7 calls. All four sources are free, so API cost is $0; the binding limits are quotas (GitHub 10–30 searches/min, Stack Exchange 300 or 10,000/day, YouTube 100 searches/day per project). Ingestion counted against the plan's monthly mention limit as designed.

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
1. Supabase Pro at first paying customer (US$25/mo).
2. Vercel Pro vs. an alternative host before charging customers (US$20/mo).
3. Which AI provider/model backs SignalForge credits, and per-plan token budgets (M4).
4. Stripe account setup (M6).
