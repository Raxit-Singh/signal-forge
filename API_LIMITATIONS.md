# API limitations

Checked against official documentation or live API responses on 2026-10-14/15 unless marked otherwise. Limits change — re-check before each integration milestone.

## Implemented public sources (Milestone 2)

"Measured" = observed in live calls from this project on 2026-10-14. Every adapter takes tokens from a shared Postgres token bucket before each call (`rate_limit_buckets`), so all workers together stay under these limits, and every call is recorded in `api_usage_events`.

### Hacker News — Algolia HN Search API (`/search_by_date`)
- No key. `numericFilters=created_at_i>=…,created_at_i<…` for exact windows; stories and comments (`tags=(story,comment)`).
- SignalForge budget: bucket of 30, refilling 1/second. HN's documented fair-use limit (10,000 requests/hour per IP) is not confirmed on an official page — kept far below it.
- Result cap: 100 hits per page; we fetch ≤3 pages per keyword per run (initial scans) or 2 (scheduled). More results → coverage marked **partial** with the reason.
- One query per keyword (no OR support).

### GitHub — REST `GET /search/issues`
- Query: `"a" OR "b" … in:title,body is:issue created:<since>..<until>` — one combined query per product (≤5 keywords).
- **Measured:** without a token, `x-ratelimit-limit: 10` per minute (search resource). With `GITHUB_TOKEN`: 30/minute. Budget: 8/min without token, 25/min with.
- **At most 1,000 results per query.** Measured: "Excalidraw" matched 1,806 issues in 30 days; the newest 300 were collected and the window recorded as partial.
- **Issues only.** Pull requests, issue comments and discussions are not collected yet.
- Precision: issue-template dumps (`<details>` blocks, HTML comments) are ignored when matching; a keyword found only in code blocks is weak evidence ("needs review"). Bot accounts are skipped.
- Rate-limit responses (403/429 with `x-ratelimit-remaining: 0`) defer the job until `x-ratelimit-reset` without consuming a retry attempt (verified live).

### Stack Exchange API 2.3 — `/search/excerpts` (Stack Overflow only)
- **Measured:** without a key, `quota_max: 300` requests/day per IP. With `STACKEXCHANGE_KEY` (free, stackapps.com): 10,000/day per the API's published policy (official docs page could not be fetched from this environment; re-verify at api.stackexchange.com/docs/throttle).
- Budget: 280/day without key, 9,000/day with key, burst 20.
- `backoff` (seconds) in any response pauses the whole source; `throttle_violation` waits the number of seconds the error message states; quota exhaustion waits until UTC midnight.
- The excerpts endpoint **does not return authors**, so unique-author counts are not measurable for Stack Exchange.
- Other Stack Exchange sites are not searched yet.

### YouTube Data API v3 — needs `YOUTUBE_API_KEY`
- Checked 2026-10-14 (developers.google.com/youtube/v3/determine_quota_cost): **`search.list` has its own bucket of 100 calls/day per Google Cloud project**, separate from the 10,000-unit pool used by `videos.list` (1) and `commentThreads.list` (1). Quotas reset at midnight Pacific.
- Implication: **≈95 product searches per day across all customers combined.** Each product's keywords are combined into one `|` (OR) query and searched at most daily (newest 50 videos), plus one stats call and up to 5 comment calls. Beyond ~95 products with YouTube enabled, searches queue (deferred, not failed) until a free quota extension (Google audit) is granted.
- Comments are collected only on matched videos. A comment that doesn't name the product counts as a low-confidence "needs review" match via the video title.
- **Retention:** YouTube API Services policies limit how long data obtained without user authorization may be stored without refresh; SignalForge sets a 30-day `retain_until` on every YouTube row and a daily job deletes expired rows. Have this reviewed against the current policy text before launch.
- **Not verified live:** no key is configured on this server yet. The adapter is covered by fixture tests only (catalog status "Built · not yet verified live").

## Free official sources added in Milestone 2.5 (verified live 2026-10-15)

### Bluesky — AppView `app.bsky.feed.searchPosts`
- Endpoint `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts`, no auth needed (**measured**: 200). `public.api.bsky.app` returned **403** for search from this environment, so it isn't used. This unauthenticated access is not a documented guarantee — monitor `source_health`. **Observed 2026-10-16 05:00 UTC:** one scheduled check got **403** from `api.bsky.app` too; the same request (same parameters and User-Agent) returned 200 minutes later from curl and Node. The job is not retried (403 is treated as an auth error), but the query's checkpoint holds and it is rescheduled sooner (30 min × 2ⁿ), so the window is re-searched. **Root cause (found 2026-10-16 07:15 UTC):** the unauthenticated AppView answers the first page but refuses every request carrying a `cursor` (403 "Request forbidden by administrative rules"), so any keyword with more than one page of results failed the whole run. The adapter now pages by moving `until` back to the oldest post seen (measured: 3 pages, 293 unique "starlink" posts, all 200), and a refused later page keeps the earlier results as a partial run. If unauthenticated search is restricted further, Bluesky will need an authenticated session.
- `q` supports phrases and `since` / `until` / `sort=latest` / `cursor`; **no OR**, so one query per keyword (every configured keyword since 2026-10-16; previously ≤5). Replies are found by search (flagged `reply`).
- **High-volume keywords (investigated 2026-10-16):** a check reads at most 3 pages × 100 = **300 posts per keyword** (newest first). "starlink" returned 292–298 posts per check and every check ended partial (saturated): more than 300 matching posts were published since the previous check. The checkpoint holds, but because search is newest-first, the next check again reads the newest 300, so **posts older than the 300th in a busy window are never fetched** (a permanent gap, recorded as partial coverage). Capacity per keyword ≈ 300 × checks per day: Free (daily) ~300/day, Pro/Scale (down to hourly) up to ~7,200/day — saturation speeds a platform up to its plan floor. Future options (not in this task): resume paging from the oldest post fetched (`until`) in the next check, more pages for saturated keywords, or the Jetstream firehose.
- Search covers what Bluesky has indexed; it is not a complete archive. Jetstream (the full firehose) would need a long-running WebSocket consumer, which this serverless deployment doesn't have; not implemented.
- **Live check:** 82 Excalidraw mentions stored (55 posts, 27 replies); all 82 re-fetched via `app.bsky.feed.getPosts` exist and mention Excalidraw; 5/5 sampled links returned 200.

### DEV Community — Forem API v1
- `/api/articles?tag=<tag>` and `/api/comments?a_id=<id>`. **There is no documented full-text search**, so DEV finds articles *tagged* with a keyword (tags are lowercase letters/digits; domains and handles can't be tags and are skipped). Comments are read for selected relevant articles only.
- **Live check:** 13 articles tagged `excalidraw`, newest-first order confirmed; 4 of 5 sampled article links returned 200 — one returned **404 although the API still lists it** (removed/hidden page). Comment expansion returned 13 comments with working links.

### Apple App Store — public customer-reviews feed
- `itunes.apple.com/{country}/rss/customerreviews/page=N/id={appId}/sortby=mostrecent/json`, from the product's App Store URL. Most recent reviews only; **no per-review link** (stored links open the listing's reviews page, marked "listing").
- **Live check:** 46 recent reviews returned for a public app; listing link returned 200.

## Paid sources via API Direct (9 of 11 search endpoints validated live 2026-10-16)

Source: API Direct's official docs (`github.com/joshwallerr/apidirect-docs`, mirrored at apidirect.io/docs), read 2026-10-15, plus one **authorized live test on 2026-10-16** (`npm run test:apidirect-live`, cumulative cap $0.05, provider spending limit confirmed by the founder, paid production monitoring off). Unit tests still use mocked responses; no automated test calls API Direct.

### Live validation (2026-10-16)

| # | Endpoint | Query | HTTP | Pages | Results | Charged (documented rules) | Findings |
|---|---|---|---|---|---|---|---|
| 1 | Reddit search posts | `"starlink" OR "wisprflow"` | 200 | 1 | 20 | $0.003 | Dates UTC (consistent with run time); permalinks to threads; no duplicates |
| 2 | Reddit search comments | `starlink`, `pages=2` | 200 | 2 | 45 | $0.006 | See comment findings below |
| 3 | X search posts | `"starlink" OR "wisprflow"` | 200 | 1 | 20 | $0.006 | 12 replies, 3 quotes, 5 top-level; `date` is UTC (matched status-id time to the second, 20/20); status URLs |
| 4 | LinkedIn search posts | `"starlink" OR "wisprflow"` | 200 | 1 | 20 | $0.006 | **`date` is local time UTC+2, not UTC** (20/20 exactly 120 min ahead of the activity id) — **fixed**: time now comes from the activity id |
| 5 | TikTok search videos | `starlink` | 200 | 1 | 28 | $0.006 | 28 videos for one page (page-size assumption raised from 10 to 25); dates within 7 days |
| 6 | Instagram search posts | `starlink` | 200 | 1 | 8 | $0.006 | Relevance-ranked, dates back to 2024 (confirms "always partial"); 13.6 s response |
| 7 | Facebook search posts | `starlink` | 200 | 1 | 5 | $0.008 | Unix `timestamp` present; post and group URLs |
| 8 | Substack search posts | `starlink` | 200 | 1 | 20 | $0.003 | `has_next_page` present; dates within 7 days |
| 9 | Google web search | `"starlink" OR "wisprflow"` | 200 | 1 | 8 | $0.004 | No publication dates (discovery time stored, flagged) — as documented |
| 10 | Google News | — | not run | — | — | — | Worst case ($0.008) would have exceeded the remaining cap |
| 11 | Trustpilot reviews | — | not run | — | — | — | Stopped at #10 (priority order) |

**Spend:** 9 requests, 10 pages, **$0.048 by the documented billing rules** (all 2xx billed; recorded in `api_cost_ledger`, purpose `live_test`, fingerprint `live-test:2026-10-16`); remaining test budget $0.002. **Provider-confirmed charge: not checked** (no billing API; each endpoint's first 50 requests/month are free, so the dashboard may show $0). Nothing was written to `mentions`.

**Reddit comment search (highest priority):** the endpoint is a genuine comment-text search — 45/45 comments contain the keyword, and in at least 3 cases the parent post's title (from its URL slug) does not (r/teslamotors "that was insane, elon is the goat", r/HousingUK neighbour dispute, r/AMD_Stock daily discussion). Parent post *bodies* are not returned, so "keyword absent from the whole parent post" is not proven. The response has **no comment id, no parent post id and no comment permalink**: `title` is synthetic ("author on subreddit"), `url` is the parent's link — 10/45 a reddit.com thread/gallery/live page, 18 i.redd.it/v.redd.it media, 17 external articles. A comment permalink therefore **cannot be constructed** from documented identifiers; SignalForge keeps hashed ids (author + timestamp + parent URL; 0 collisions in 45) and labels links as opening the shared content/thread. Pagination: `pages=2` returned 45 rows in one response, 0 duplicate rows. Comment search has no date filter; all 45 were from the last hour.

**X replies:** keyword search returns matching replies (`is_reply`) and quote posts (`is_quote`) alongside top-level posts, each with its own status URL. This is keyword-matched reply discovery only — replies that don't contain the keyword still need the per-tweet replies endpoint (selected posts).

**Boolean OR:** OR was accepted by Reddit, X, LinkedIn and Google web (HTTP 200, results). Term split in the OR results: Reddit 19 starlink / 0 wisprflow, X 18 / 0, LinkedIn 19 / 1, web 8 / 0 (1–2 results matched neither term in the snippet — matched outside it). LinkedIn returning a "wisprflow" post shows both terms are searched. But one newest-first page is dominated by the high-volume term, so a rare term's posts can be pushed beyond the page cap of a busy window; the planned comparison with "wisprflow" alone didn't fit the budget. **Complete recall of combined queries is not established.** Practical rule: avoid OR-combining a very high-volume keyword with low-volume ones (future: volume-aware grouping).

Response fields observed beyond the docs are listed in `.apidirect-live/report.json` (local, gitignored).

General (docs): `X-API-Key` header; `GET https://apidirect.io/v1/...`; errors `{error, code}`; **10 concurrent requests per endpoint**; 50 free requests per endpoint per month.

**Billing rules implemented** (Pricing → How Billing Works): answered requests are billed — every 2xx **including zero results**, and 404s (one request whatever `pages` was), plus Instagram 403 `private_account`/`limited_account` and Instagram-rejected post codes; other 4xx/5xx are not billed. Endpoints with `pages=N` are billed **per page requested**. (The Substack Notes page says "per page returned"; SignalForge assumes *requested*, the more conservative reading.) Requests with no answer (timeout) are kept at their estimate as `unknown` spend.

**Dates:** `date` strings carry no zone. Parsed as UTC; Unix timestamps win when present. **Live (2026-10-16):** X matches UTC exactly (status-id time); Reddit, TikTok, Substack and Facebook are consistent with UTC; **LinkedIn is not** (UTC+2) and uses the activity id instead. If the provider's LinkedIn zone follows daylight saving, only the fallback path would be affected.

| Platform | Endpoints used | Query features (docs) | Comments | Notes |
|---|---|---|---|---|
| Reddit | `/v1/reddit/posts` (page 1–12, $/request), `/v1/reddit/comments` (pages 1–10, $/page) | OR / AND / NOT / phrases; posts: `posted_ago` 1h–12m; comments: **no date filter** | **Global comment search** (separate stream + checkpoint) | Comment results have **no id and no permalink**: `url` is the parent thread (or the shared link of a link post). Ids are hashed from author + timestamp + parent; links are labelled "opens the thread". **Live-verified 2026-10-16** (see above). |
| X | `/v1/twitter/posts` (pages 1–20), `/tweet/comments`, `/tweet/quotes` | X operators; `start_date`/`end_date` (UTC days) or `posted_ago` | Search finds replies/quotes that contain the keywords (`is_reply`/`is_quote`); other replies only via selected posts | The tweet-comments endpoint is per tweet — it is **not** a global reply search. |
| LinkedIn | `/v1/linkedin/posts` (page 1–25) | Boolean, phrases loose; `posted_ago` 24h/7d/30d | None | `date` observed as UTC+2 local time; publication time is taken from the activity id (top 41 bits = ms timestamp) and falls back to `date` only without one. |
| TikTok | `/v1/tiktok/videos` (pages 1–10), `/v1/tiktok/video/comments` | Plain keywords (loose match); `publish_time` | Selected videos only; TikTok exposes ~450 comments per video | Ads (`is_ad`) are not stored. |
| Instagram | `/v1/instagram/posts` (pages 1–20), `/post/comments` | Plain keywords; **no date filter or sort** | Selected posts only | Always recorded as partial coverage. |
| Facebook | `/v1/facebook/posts` (pages 1–15), `/post/comments` | Plain keywords, every word must appear; `start_date`/`end_date` | Selected posts only | |
| Substack | `/v1/substack/posts` (page 1–101), `/v1/substack/notes` (pages) | Plain keywords; posts relevance-ranked, `posted_ago` | None | Preview text only, not article bodies. |
| Web | `/v1/web/search` (pages 1–10) | Google operators; `time` | — | **No publication dates**: discovery time stored, flagged, excluded from charts. The product's own domain is skipped. Snippets only. |
| News | `/v1/news/articles` (`limit` ≤100, one charge) | `time_published` | — | Syndicated copies linked by normalized headline. Snippets only. |
| Trustpilot | `/v1/trustpilot/company/reviews` (pages 1–10) | by `domain` | — | Reviews of the product's own website domain only. |

**Terms:** API Direct's Terms (section 10) make the customer responsible for complying with the underlying platforms' terms; they say nothing about caching or redistribution. SignalForge stores only what the API returns (snippets, ids, counts), shares an upstream fetch only within the same moment's job (no result cache), and should have its use reviewed against each platform's terms before launch.

**YouTube via API Direct** (`/v1/youtube/videos`) is priced in the registry but deliberately not wired up: the official YouTube API is preferred.

## Sources needing the customer's authorization or approval

- **App Store Connect API:** customer creates an API key in their own account; only their apps' reviews. (The public feed above needs no key.)
- **Google Play Developer API:** customer grants a service account access in Play Console. The reviews endpoint only returns reviews created or modified in roughly the **last week**, so history begins at connection time. Not implemented: needs per-customer credentials; no competitor reviews.
- **Discord:** bot installed by a server admin; reading message content requires the privileged Message Content intent (Discord approval at 100+ servers). Monitoring needs a long-running Gateway connection (a process outside this serverless app). Not implemented.
- **Threads:** keyword search needs Meta's `threads_keyword_search` permission (app review). Disabled.

(App Store Connect, Play and Discord details were not re-checked this session; verify when implementing.)

## Not supported

| Platform | Reason |
|---|---|
| Slack | Only workspaces the customer administers; planned as a notification channel, not a public source. |
| Product Hunt | API terms restrict commercial use without permission. |

SignalForge will not scrape platforms or use methods meant to bypass their restrictions.

## Keyword coverage per platform (updated 2026-10-16)

`npm run audit:keywords` prints this for each product. **Every active keyword within the plan's allowance (Free 1, Pro 10, Scale 40 per workspace) is monitored on every platform that can search it**; keywords beyond the allowance (after a downgrade) are paused and shown as such. The Smart Monitoring page shows each keyword's real refresh interval per platform.

| Platform | Combining keywords | Per check |
|---|---|---|
| Reddit (posts and comments), X, LinkedIn, Google web, Google News | OR (+ phrases; Reddit/X/web also grouping) | One group for brand terms, one for category terms (per stream), split at the platform's term/length limits |
| GitHub | OR, ≤5 terms | OR groups of up to 5 keywords (10 keywords → 2 queries) |
| YouTube | `\|`, ≤5 terms | Same, 2 queries for 10 keywords (each uses the shared 100 searches/day quota) |
| Hacker News, Bluesky, DEV (tags) | none | One search per keyword, every check |
| Stack Overflow | none | One search per keyword; **without `STACKEXCHANGE_KEY` at most 3 per check** (shared 300 requests/day) — the rest take turns |
| TikTok, Instagram, Facebook, Substack (paid) | none | One search per keyword; at most the plan's `max_searches_per_platform` (Free/Pro 2, Scale 4) per check — the rest take turns |
| Trustpilot, App Store | — | Reviews of the product's own page; keywords not used |

**Fair rotation:** the highest-priority search (the product name) runs every check; the others take turns in fixed time slots, never more than the budget per slot, each search with its own checkpoint (a turn re-searches everything since that keyword's last check). The per-check budget is never exceeded. **Plan keyword refresh targets** (Free 7 days, Pro 24 h, Scale 6 h — targets, not guaranteed discovery times) shorten a platform's interval where the plan floor, source limits and the paid budget allow; where they don't, the conflict is recorded and the real interval shown (this replaces the earlier universal 7-day guarantee, which could exceed budgets). Keywords found by a broader search ("Octolens pricing" via "Octolens") or identical to another are covered by that search. Only what a platform genuinely can't search is left out: domains/handles on DEV (tag feeds only), and ambiguous keywords without context words (anywhere). Ambiguous keywords with context are searched with their first context word where a platform can't group (HN/SO/GitHub/YouTube search them alone and keep results only when a context word appears, as before).

The first-5-keyword limit of the Milestone 2 sources (`sync_monitoring_queries`) was removed on 2026-10-16; rows whose search is unchanged were taken over with their checkpoints.

The combined-vs-separate equivalence (same mentions from one OR query as from one query per keyword) is shown only on **mocked** responses; the live test (above) confirmed OR is accepted and both terms are searched, but not equal recall.

## Platform-wide rules SignalForge follows
- Store only what each platform permits (excerpts and IDs; honour deletion where the API exposes it).
- Missing or failed monitoring windows are recorded in `coverage_windows` and shown as gaps — never as zero mentions.
