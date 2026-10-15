# API limitations

Checked against official documentation or live API responses on 2026-10-14 unless marked otherwise. Limits change — re-check before each integration milestone.

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
- **Not verified live:** no key is configured on this server yet. The adapter is covered by fixture tests only.

## Sources needing the customer's authorization (Milestone 6)

- **App Store Connect API:** customer creates an API key in their own account; only their apps' reviews.
- **Google Play Developer API:** customer grants a service account access in Play Console. The reviews endpoint only returns reviews created or modified in roughly the **last week**, so history begins at connection time.
- **Discord:** bot installed by a server admin; reading message content requires the privileged Message Content intent, which needs Discord's approval for bots in 100+ servers.

(These three were not re-checked this session; verify when implementing.)

## Not supported

| Platform | Reason |
|---|---|
| Reddit | Commercial API use requires an agreement with Reddit. |
| X (Twitter) | Search requires a paid API tier. |
| Instagram, Facebook | Meta APIs don't offer general public keyword search for third-party apps. |
| LinkedIn | No public post-search API for this use. |
| Slack | Only workspaces the customer administers; planned as a notification channel, not a public source. |
| Product Hunt | API terms restrict commercial use without permission. |

The reasons above reflect each platform's published API terms as known at the time of writing and were not re-checked this session.

SignalForge will not scrape these platforms or use methods meant to bypass their restrictions. Each appears in the UI as unavailable with its reason. Partner approval would move one to "planned".

## Platform-wide rules SignalForge follows
- Store only what each platform permits (excerpts and IDs; honour deletion where the API exposes it).
- Missing or failed monitoring windows are recorded in `coverage_windows` and shown as gaps — never as zero mentions.
