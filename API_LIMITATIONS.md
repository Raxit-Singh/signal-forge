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
- Endpoint `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts`, no auth needed (**measured**: 200). `public.api.bsky.app` returned **403** for search from this environment, so it isn't used. This unauthenticated access is not a documented guarantee — monitor `source_health`.
- `q` supports phrases and `since` / `until` / `sort=latest` / `cursor`; **no OR**, so one query per keyword (≤5 per product). Replies are found by search (flagged `reply`).
- Search covers what Bluesky has indexed; it is not a complete archive. Jetstream (the full firehose) would need a long-running WebSocket consumer, which this serverless deployment doesn't have; not implemented.
- **Live check:** 82 Excalidraw mentions stored (55 posts, 27 replies); all 82 re-fetched via `app.bsky.feed.getPosts` exist and mention Excalidraw; 5/5 sampled links returned 200.

### DEV Community — Forem API v1
- `/api/articles?tag=<tag>` and `/api/comments?a_id=<id>`. **There is no documented full-text search**, so DEV finds articles *tagged* with a keyword (tags are lowercase letters/digits; domains and handles can't be tags and are skipped). Comments are read for selected relevant articles only.
- **Live check:** 13 articles tagged `excalidraw`, newest-first order confirmed; 4 of 5 sampled article links returned 200 — one returned **404 although the API still lists it** (removed/hidden page). Comment expansion returned 13 comments with working links.

### Apple App Store — public customer-reviews feed
- `itunes.apple.com/{country}/rss/customerreviews/page=N/id={appId}/sortby=mostrecent/json`, from the product's App Store URL. Most recent reviews only; **no per-review link** (stored links open the listing's reviews page, marked "listing").
- **Live check:** 46 recent reviews returned for a public app; listing link returned 200.

## Paid sources via API Direct (built, NOT validated live)

Source: API Direct's official docs (`github.com/joshwallerr/apidirect-docs`, mirrored at apidirect.io/docs), read 2026-10-15. **No API key is configured, so no request has been made to API Direct.** Every connector is tested only with mocked responses shaped like the documented examples. Response fields beyond the documented ones were not observed.

General (docs): `X-API-Key` header; `GET https://apidirect.io/v1/...`; errors `{error, code}`; **10 concurrent requests per endpoint**; 50 free requests per endpoint per month.

**Billing rules implemented** (Pricing → How Billing Works): answered requests are billed — every 2xx **including zero results**, and 404s (one request whatever `pages` was), plus Instagram 403 `private_account`/`limited_account` and Instagram-rejected post codes; other 4xx/5xx are not billed. Endpoints with `pages=N` are billed **per page requested**. (The Substack Notes page says "per page returned"; SignalForge assumes *requested*, the more conservative reading.) Requests with no answer (timeout) are kept at their estimate as `unknown` spend.

**Dates:** `date` strings carry no zone. Two documented examples that also give a Unix timestamp (TikTok, Facebook) match UTC, so dates are parsed as UTC; timestamps win when present. Unverified until a live call.

| Platform | Endpoints used | Query features (docs) | Comments | Notes |
|---|---|---|---|---|
| Reddit | `/v1/reddit/posts` (page 1–12, $/request), `/v1/reddit/comments` (pages 1–10, $/page) | OR / AND / NOT / phrases; posts: `posted_ago` 1h–12m; comments: **no date filter** | **Global comment search** (separate stream + checkpoint) | Comment results have **no id and no permalink**: `url` is the parent thread (or the shared link of a link post). Ids are hashed from author + timestamp + parent; links are labelled "opens the thread". |
| X | `/v1/twitter/posts` (pages 1–20), `/tweet/comments`, `/tweet/quotes` | X operators; `start_date`/`end_date` (UTC days) or `posted_ago` | Search finds replies/quotes that contain the keywords (`is_reply`/`is_quote`); other replies only via selected posts | The tweet-comments endpoint is per tweet — it is **not** a global reply search. |
| LinkedIn | `/v1/linkedin/posts` (page 1–25) | Boolean, phrases loose; `posted_ago` 24h/7d/30d | None | |
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

## Platform-wide rules SignalForge follows
- Store only what each platform permits (excerpts and IDs; honour deletion where the API exposes it).
- Missing or failed monitoring windows are recorded in `coverage_windows` and shown as gaps — never as zero mentions.
