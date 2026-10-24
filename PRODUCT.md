# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Indie app makers and small teams (solo founders to a handful of people) who ship software, often consumer or mobile apps, and can't afford a social-listening agency or an enterprise tool. They want to know what people are saying about their app, find the bugs and feature requests hidden in that talk, and act on them without reading every post themselves.

## Product Purpose

SignalForge watches where people talk about a product (social platforms, app stores, developer communities, news and the web), shows how much and where they talk, and turns the posts into prioritised bugs, complaints and feature requests. From an issue, the maker hands the problem to their own Claude, which reads the issue and its reports through the SignalForge connector and looks for the fix in their code.

Success: a maker opens SignalForge, sees what matters this week, and gets from "people are complaining" to "here's the cause in my code" quickly, at a monthly cost a small team can carry.

## Positioning

- **Feedback to fixes.** Brand-listening tools stop at mentions and sentiment. SignalForge groups public posts into issues, ranks them, and connects them to the maker's code through Claude ("Investigate with Claude", the SignalForge connector).
- **Cheap, smart monitoring.** Scanning adapts per product and platform (busy platforms are checked often, quiet ones less), paid searches that return mostly unrelated posts are throttled, and costs are tracked per call, so continuous monitoring stays affordable for small teams.

## Operating Context

- Makers set up a product (name, website, app store links), keywords and sources; SignalForge then scans on its own schedule. Scanning can be stopped and resumed.
- Daily surfaces: Overview, Mentions, Buzz Analytics, Feedback Intelligence (issues), Competitors, Product Insights, Smart Monitoring, Integrations, Reports, Settings.
- Claude is used outside SignalForge: the maker connects SignalForge to Claude once (Settings → Claude, "SignalForge for Claude") and continues the conversation in Claude; nothing is reported back into SignalForge.
- Times are shown in each viewer's own time zone.

## Capabilities and Constraints

- Sources: free (Hacker News, GitHub, Stack Overflow, Bluesky, DEV, App Store reviews, YouTube) and paid (Reddit, X, Instagram, Facebook, LinkedIn, TikTok, Substack, Trustpilot, Google Web, Google News) through API Direct, TikHub and Serper.
- Relevance and classification by AI (Gemini); issues are clusters of posts with reach, platforms, trend and priority.
- Numbers are traceable to stored posts; partial coverage and data gaps are labelled rather than hidden.
- Plans: Free, Starter, Pro, Scale and Business tiers with keyword, mention and paid-source allowances defined in the database. Prices and allowances are not to be changed as a side effect of other work.
- "Investigate with Claude" requires the SignalForge connector; it is read-only toward SignalForge.
- Undecided: visual identity (see Brand Commitments).

## Brand Commitments

None fixed yet. The name, logo and current look (dark UI, orange accent) are the incumbent implementation, not binding commitments.

## Evidence on Hand

- Real monitored products used in testing: toing (a food-delivery app) and Gears of War: E-Day, with real collected mentions and cost records.
- No customer testimonials, case studies, customer logos, press or published benchmarks exist. Do not invent them.

## Product Principles

1. Get the maker from noise to action: every screen should lead toward a decision or a fix, not just a chart.
2. Trust is earned with traceability: show where a number comes from, and say when coverage is partial.
3. Affordable by design: features must not assume an enterprise budget, for users or for running costs.
4. Respect the maker's tools: hand work to the tools they already use (Claude, their repository) instead of rebuilding them inside SignalForge.
