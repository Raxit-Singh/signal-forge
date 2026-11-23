# Heardex listing text

Copy for each app directory. Server address everywhere: `https://www.heardex.com/api/mcp`

Links used by all three:

| Field | Value |
|---|---|
| Website | https://www.heardex.com |
| Documentation | https://www.heardex.com/docs/mcp |
| Privacy policy | https://www.heardex.com/legal/privacy |
| Terms of service | https://www.heardex.com/legal/terms |
| Support | support@heardex.com · https://www.heardex.com/legal/contact |
| Icon | `directory/icons/heardex-512.png` (or `heardex-1024.png`) |

## Claude (claude.ai/directory/manage)

**Server name** (≤100): Heardex

**One-liner** (≤200): Ask Claude about your product's public feedback: ranked bugs, feature requests and complaints from Reddit, Hacker News, GitHub and app stores, with links to every post.

**Description** (≤2,000):

> Heardex watches Reddit, Hacker News, GitHub, the App Store, Google Play and other public places for posts about your product, and groups them into issues: bugs, feature requests, complaints and praise, ranked by how many people raise them and how fast they are growing.
>
> With the Heardex connector, Claude can read your workspace and answer in plain words: what the top issues are this week, which posts are behind a bug, why an issue is marked critical, or whether mentions spiked and why. Every answer links back to the public posts it comes from.
>
> Developers can also click "Investigate with Claude" on an issue in Heardex: Claude reads the issue and its evidence, looks for the cause in your connected repository and sends a report back to Heardex for you to review. Nothing is changed in your code without your approval.
>
> Claude sees only the workspace you approve when you sign in, and can't change your settings or delete anything. You need a Heardex account with at least one product set up.

**Categories** (1–5): Productivity · Developer tools · Analytics (pick the closest the portal offers)

**Primary use cases**: Reviewing and prioritising product feedback; finding the evidence behind bug reports and complaints; investigating the cause of a reported bug in a connected repository.

**Setup before connecting**: A Heardex account (www.heardex.com) with at least one product added. Investigation also needs a GitHub repository connected in Heardex.

**Reads or writes**: Both. Eight tools only read. Two tools write, and only to a developer-agent task the user started in Heardex: `submit_investigation_report` adds a report, `report_implementation_status` adds a progress update. Neither deletes or overwrites data.

**Authentication**: OAuth 2.1 with dynamic client registration and PKCE. Leave the client ID and secret empty.

**Data handling**: First-party API (Heardex's own). No personal health data. No sponsored content.

**Example prompts**:
- What are the top issues people are raising about my product this week?
- Show me the posts behind my most reported bug.
- Why is the top complaint marked critical?
- Did mentions of my product spike recently, and why?

## ChatGPT (platform.openai.com/plugins)

Upload `directory/heardex-chatgpt-plugin.zip`. Its listing text is in `directory/chatgpt/plugin.json`:

- Name: Heardex · Subtitle: Your product feedback, ranked · Category: Productivity
- Starter prompts, capabilities, five positive and three negative test cases, release notes: already filled in.
- **Still needed:** `demo_recording_url` (enter it in the portal's Review details, or add it to plugin.json and rebuild),
  and the reviewer test account (Review details only, never in the ZIP).

## Gemini (connected.google.com/console)

**Connected app name**: Heardex

**Connection type**: MCP server · Category: Productivity (can't be changed later)

**Description** (one sentence, under 30 words): Read your product's public feedback from Reddit, Hacker News, GitHub and app stores, ranked into bugs, feature requests and complaints, with links to every post.

**Capabilities** (one per entry, at least 3):
- Rank your product's feedback issues by priority
- Show the public posts behind a bug or complaint
- Explain how an issue's priority was decided
- Explain recent spikes in mentions of your product
- List the competitors Heardex tracks for your product

**Example prompts** (at least 3; at least 2 start with @Heardex; at least 1 names it mid-sentence; no numbers or quotes):
- @Heardex what are the top issues for my product this week
- @Heardex show me the posts behind my most reported bug
- Ask Heardex why the top complaint is marked critical
- Use @Heardex to check whether mentions of my product spiked recently

**Authorization**: Yes → User-delegated (Authorization Code) → Client ID metadata or Dynamic client registration.
Google then shows the redirect URIs for this app: send them to the developer so Heardex accepts them (the
user_bound_custom-mcp ones are already accepted; others need adding).

**Tools**: enable all. Don't request location or locale.
