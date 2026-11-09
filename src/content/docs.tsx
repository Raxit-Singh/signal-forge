// The docs (src/app/docs). Describe what the code does today; plan numbers come from the plans table (`ctx.plans`).
import Link from "next/link";
import { formatPrice, intervalPrice, type Plan } from "@/lib/domain/plans";
import { Shot } from "@/components/marketing/shot";
import { LEGAL } from "@/lib/legal";

export interface DocContext { plans: Plan[]; mcpUrl: string }
export interface Doc {
  /** "" is the docs home. */
  slug: string;
  group: "Start" | "Monitoring" | "Insights" | "Account";
  title: string;
  description: string;
  Body: (ctx: DocContext) => React.ReactNode;
}

const n = (v: number) => v.toLocaleString("en-US");
const every = (m: number) => (m >= 10080 ? "once a week" : m >= 1440 ? "once a day" : `every ${m / 60} hours`);
const A = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href}>{children}</Link>;

/** Platforms, as the source adapters and their collection profiles define them (src/lib/sources). */
export const FREE_PLATFORMS: Array<[string, string, string]> = [
  ["Hacker News", "Stories and comments that contain a keyword", "Full archive"],
  ["GitHub", "Public issues with a keyword in the title or body", "Full history (up to 1,000 results per search, older ones reached by narrowing the dates)"],
  ["Stack Overflow", "Questions and answers", "Full history"],
  ["Bluesky", "Posts and replies", "What Bluesky's search index holds (not a complete archive)"],
  ["DEV", "Articles tagged with a keyword, and their comments", "Newest 100 articles per tag"],
  ["App Store", "Reviews of your app (from its App Store link)", "Most recent reviews (Apple's feed holds up to 500)"],
];
export const PAID_PLATFORMS: Array<[string, string, string]> = [
  ["Reddit", "Posts and comments", "Posts up to 12 months back (240 per search); the newest 250 comments per search"],
  ["X", "Posts, replies and quotes", "By date range, in whole days; very busy days can't be read completely"],
  ["LinkedIn", "Public posts", "Last 30 days"],
  ["TikTok", "Videos", "Up to 180 days"],
  ["Instagram", "Public posts", "A relevance-ranked sample, never a complete history"],
  ["Facebook", "Public posts", "By date range, in whole days"],
  ["Substack", "Posts and notes", "Posts up to 12 months back; the newest notes"],
  ["News", "News articles", "Up to 100 articles per search, within a year"],
  ["Web", "Web pages", "Ranked results within a year (pages often have no publication date)"],
];

function PlatformTable({ rows }: { rows: Array<[string, string, string]> }) {
  return (
    <div className="hx-alt-table">
      <table>
        <thead><tr><th scope="col">Platform</th><th scope="col">What we search</th><th scope="col">How far back</th></tr></thead>
        <tbody>{rows.map(([p, w, h]) => <tr key={p}><th scope="row" className="!text-[var(--ink)]">{p}</th><td>{w}</td><td>{h}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function PlanTable({ plans, cols }: { plans: Plan[]; cols: Array<[string, (p: Plan) => string]> }) {
  return (
    <div className="hx-alt-table">
      <table>
        <thead><tr><th scope="col">Plan</th>{cols.map(([h]) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{plans.map((p) => <tr key={p.id}><th scope="row" className="!text-[var(--ink)]">{p.name}</th>{cols.map(([h, f]) => <td key={h}>{f(p)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export const DOCS: Doc[] = [
  {
    slug: "",
    group: "Start",
    title: "Getting started",
    description: "Set up Heardex in a few minutes: your product, its keywords, and how far back to search.",
    Body: ({ plans }) => (
      <>
        <p>Heardex finds what people say about your product across social platforms, developer communities, app stores, news and the web, and sorts it into what to act on. Setting it up takes a few minutes.</p>
        <h2>1. Create your account</h2>
        <p>Sign up with your email or with Google. Heardex creates a workspace for you; everything you add lives in it, and you can invite your team later.</p>
        <h2>2. Add your product</h2>
        <p>Give its name and, if it has them, its website and App Store link. The links help Heardex tell your product apart from other things with the same name, and the App Store link lets it read your reviews.</p>
        <h2>3. Choose keywords</h2>
        <p>Keywords are the names people use for your product. Heardex suggests some and warns you when one is a common word that would bring in unrelated posts. Your plan sets how many keywords you can have: {plans.map((p) => `${p.name} ${n(p.maxKeywords)}`).join(", ")}. See <A href="/docs/keywords">Keywords and competitors</A>.</p>
        <h2>4. Pick how far back to search</h2>
        <p>Heardex can search the past as well as watch for new posts. Choose since launch, 7, 30, 90, 180 or 365 days, or a date, up to your plan&apos;s history. See <A href="/docs/history">History search</A>.</p>
        <h2>5. Read what comes in</h2>
        <p>Mentions start arriving within minutes. Overview shows what matters this week; Mentions lists every post; Issues groups them into problems to fix; Trends shows volume and spikes over time.</p>
        <h2>Find your way around</h2>
        <p>Every page of the app has the same frame: the sidebar on the left, the search and date range along the top.</p>
        <Shot shot="overview" priority spots={[
          { x: 16.2, y: 10, at: [8, 10], label: "Product switcher.", text: "Pick which product you're looking at; every page follows it." },
          { x: 16.2, y: 22.7, at: [6, 18.8], label: "Sidebar.", text: "Overview, Mentions and Issues; Trends, Competitors and Insights; Monitoring and Reports." },
          { x: 69.6, y: 2.8, at: [52, 2.8], label: "Search.", text: "Find a mention or an issue, or jump to any page (⌘K)." },
          { x: 87, y: 7.4, at: [87.5, 2.8], label: "Date range.", text: "The period every number and chart on the page covers." },
          { x: 33.4, y: 41.3, at: [22, 48], label: "Platform cards.", text: "Mentions per platform for the period, each with its trend." },
          { x: 16.2, y: 72.5, at: [8, 77], label: "Plan usage.", text: "How much of this month's mention allowance is used." },
        ]} />
        <div className="hx-alt-table">
          <table>
            <thead><tr><th scope="col">In the sidebar</th><th scope="col">What it shows</th></tr></thead>
            <tbody>
              {[
                ["Overview", "This period at a glance: total mentions, where the conversation is, platform cards, open issues and negative posts by weekday."],
                ["Mentions", "Every mention, with filters by platform, type, sentiment and relevance, and the matches waiting for your review."],
                ["Issues", "Mentions grouped into bugs, feature requests and complaints, ranked by priority (paid plans)."],
                ["Trends", "Mention volume over time, unique authors, engagement and period-over-period changes."],
                ["Competitors", "Share of voice, volume and sentiment against the competitors you add."],
                ["Insights", "Deeper analysis of open issues: summaries, feature evaluations, GitHub checks and issue drafts, and Claude's investigations."],
                ["Monitoring", "Scan status, keyword performance, where mentions come from and when each platform is checked next."],
                ["Reports", "The weekly report and daily summaries, to read, print or export as CSV."],
                ["Settings", "Workspace and members, products and keywords, Claude, plan and billing, and your account."],
              ].map(([page, what]) => <tr key={page}><th scope="row" className="!text-[var(--ink)]">{page}</th><td>{what}</td></tr>)}
            </tbody>
          </table>
        </div>
        <h2>Invite your team</h2>
        <p>Add teammates from Settings → Workspace. Each member is an owner, admin, member or viewer. There&apos;s no charge per person.</p>
      </>
    ),
  },
  {
    slug: "platforms",
    group: "Monitoring",
    title: "Tracked platforms",
    description: "Every platform Heardex searches, what it searches there, and how far back it can reach.",
    Body: ({ plans }) => (
      <>
        <p>Heardex searches each platform for your keywords and keeps every public post that&apos;s about your product. How far back it can reach depends on what each platform allows; partial coverage is labelled in the app rather than hidden.</p>
        <p>The Monitoring page shows which platforms are being searched for a product, how many mentions each brings in and when each is checked next.</p>
        <Shot shot="monitoring" spots={[
          { x: 35.2, y: 40.3, at: [23, 42], label: "Scan status.", text: "Whether scanning is live; stop and resume it here." },
          { x: 52.8, y: 33, at: [64, 38.5], label: "Last and next scan.", text: "When the product was last searched and when it will be next." },
          { x: 64.1, y: 46.5, at: [41.5, 63], label: "Keyword performance.", text: "Mentions per keyword and the platforms they came from." },
          { x: 97.7, y: 46.5, at: [72, 63], label: "Where mentions come from.", text: "Each platform's share of the period's mentions." },
          { x: 97.7, y: 84.3, at: [59, 93.5], label: "Scan schedule.", text: "When each platform is checked over the next 24 hours." },
        ]} />
        <h2>On every plan</h2>
        <PlatformTable rows={FREE_PLATFORMS} />
        <h2>On paid plans</h2>
        <PlatformTable rows={PAID_PLATFORMS} />
        <p>YouTube, Google Play reviews and Trustpilot reviews are being tested and will be listed here once they&apos;re verified.</p>
        <h2>How often each platform is checked</h2>
        <p>Heardex learns how often new posts arrive on each platform for each keyword and checks busy places more often than quiet ones, within your plan:</p>
        <PlanTable plans={plans} cols={[
          ["Checks", (p) => (p.monitoringIntervalMinutes >= 1440 ? `Up to ${every(p.monitoringIntervalMinutes)}` : "As often as hourly")],
          ["Every keyword searched at least", (p) => every(p.keywordRefreshTargetMinutes)],
        ]} />
        <p>These are targets, not guarantees: platforms and data providers have their own limits. Paid platforms pause when your mentions for the month run out and resume when the allowance renews.</p>
      </>
    ),
  },
  {
    slug: "keywords",
    group: "Monitoring",
    title: "Keywords and competitors",
    description: "How keywords work, how competitors share them, and how to avoid unrelated posts.",
    Body: ({ plans }) => (
      <>
        <p>A keyword is a name Heardex searches for: your product&apos;s name, a variation of it, or a competitor&apos;s name. One keyword tracks one name.</p>
        <h2>How many you get</h2>
        <PlanTable plans={plans} cols={[
          ["Keywords", (p) => n(p.maxKeywords)],
          ["Products", (p) => n(p.maxProducts)],
          ["Competitors per product", (p) => (p.maxCompetitorsPerProduct ? `Up to ${p.maxCompetitorsPerProduct}` : "None")],
        ]} />
        <p>Competitors share your keywords: a competitor&apos;s name is one keyword, and their mentions count toward the same monthly allowance. A product needs at least one keyword of its own.</p>
        <h2>Where to change them</h2>
        <p>Open Settings → Products and choose Keywords next to a product. Your product&apos;s name is always searched; add the other names people use, and switch them on or off.</p>
        <Shot shot="keywords" spots={[
          { x: 32.2, y: 41.2, at: [12, 41], label: "Your product's name.", text: "Always monitored." },
          { x: 82.8, y: 33.6, at: [80, 41], label: "Needs context.", text: "For a name that's also a common word: a post counts only when a context term appears too." },
          { x: 84.2, y: 89.5, at: [44, 94], label: "Add a keyword.", text: "A short form, a handle or a common misspelling." },
        ]} />
        <p>Competitors are added on the Competitors page. Each one uses a keyword from the same total, and can fetch its last 30 days when you add it.</p>
        <Shot shot="competitors" spots={[
          { x: 29.9, y: 31.8, at: [24, 34.5], label: "Add competitor.", text: "Opens the form below." },
          { x: 44.8, y: 65, at: [32, 67.5], label: "Name and website.", text: "The name is always searched; up to two extra keywords are optional." },
          { x: 19.8, y: 73.5, at: [25, 76.5], label: "Also fetch the last 30 days.", text: "Without it, the comparison starts today." },
          { x: 52.8, y: 10, at: [69.5, 23], label: "The comparison.", text: "Share of voice, volume and sentiment appear here once a competitor is added." },
        ]} />
        <h2>Choosing good keywords</h2>
        <ul>
          <li>Use the names people actually type, including short forms and common misspellings.</li>
          <li>Heardex warns when a keyword is a common word. A product called “Notes” will match every post about notes, so add context, such as the website, or use a more specific name.</li>
          <li>Your website and app store links help Heardex check that a post is about your product before it counts.</li>
        </ul>
        <h2>Turning keywords off</h2>
        <p>A keyword you turn off keeps its mentions but isn&apos;t searched. If you&apos;re over your plan&apos;s allowance after a downgrade, the extra keywords are paused until you turn some off or change plan.</p>
      </>
    ),
  },
  {
    slug: "history",
    group: "Monitoring",
    title: "History search",
    description: "Searching the past when you add a product: the options, plan limits and what each platform allows.",
    Body: ({ plans }) => (
      <>
        <p>When you add a product, Heardex can search the past so your dashboard isn&apos;t empty on the first day. You choose how far back: since launch (with a launch date), 7, 30, 90, 180 or 365 days, or a custom date. The default is 30 days.</p>
        <h2>Plan limits</h2>
        <PlanTable plans={plans} cols={[["History", (p) => `${n(p.historyDays)} days`]]} />
        <h2>What to expect</h2>
        <ul>
          <li>History fills in the background while new mentions keep arriving. The app shows each platform&apos;s state: searching, partly collected (a platform limit was hit), paused, completed or unavailable.</li>
          <li>Each platform reaches only as far as it allows: see <A href="/docs/platforms">Tracked platforms</A>. LinkedIn, for example, only returns the last 30 days.</li>
          <li>History counts toward your monthly mentions. If the allowance runs out, history search pauses until it renews.</li>
          <li>Old posts are placed on the day they were published, so filling in history never shows up as a spike today.</li>
        </ul>
      </>
    ),
  },
  {
    slug: "mentions",
    group: "Monitoring",
    title: "Mentions and your allowance",
    description: "What counts as a mention, what happens when the month's mentions run out, and held mentions.",
    Body: ({ plans }) => (
      <>
        <p>Each plan includes a number of mentions a month. Only new, relevant mentions count.</p>
        <PlanTable plans={plans} cols={[["Mentions a month", (p) => n(p.monthlyMentionLimit)]]} />
        <h2>The Mentions page</h2>
        <p>Every mention lands on the Mentions page. Matches Heardex isn&apos;t sure about wait for review there: mark each one Relevant or Not relevant.</p>
        <Shot shot="mentions" spots={[
          { x: 33, y: 38.3, at: [26.5, 41], label: "Review matches.", text: "Go through the posts waiting for a decision." },
          { x: 44.4, y: 45.9, at: [57, 50], label: "Platforms.", text: "Pick one to see only its mentions." },
          { x: 51.5, y: 63.3, at: [34.5, 65.6], label: "Quick views.", text: "All, needs review, negative and positive." },
          { x: 57.5, y: 69.9, at: [38, 71.8], label: "Filters.", text: "Platform, type, sentiment and relevance; duplicates and reposts are hidden unless you ask." },
          { x: 74.2, y: 63.5, at: [83, 65.6], label: "Search.", text: "Find mentions by their text." },
        ]} />
        <h2>What counts</h2>
        <ul>
          <li><strong>Counted:</strong> each new, unique mention that matches your keywords and passes the relevance check, or that your team marks relevant.</li>
          <li><strong>Not counted:</strong> duplicates, reposts of a post already stored, posts seen again, items waiting for review, ones you exclude, empty searches and failed requests.</li>
          <li>Marking a counted mention “Not relevant” gives it back to this month&apos;s allowance.</li>
        </ul>
        <h2>When the month&apos;s mentions run out</h2>
        <ul>
          <li>New mentions are <strong>held</strong>: not shown, not counted and not thrown away. Up to 1,000 are held per month, kept for 30 days after the month ends.</li>
          <li>Paid platforms pause until the allowance renews. Your existing mentions stay available.</li>
          <li>Nothing extra is charged, and your plan is never upgraded on its own.</li>
          <li>After an upgrade, an admin can bring held mentions in, oldest first, up to the new allowance.</li>
        </ul>
        <p>You&apos;re warned at 80% and 90% of the allowance. On yearly billing the allowance still renews every month.</p>
      </>
    ),
  },
  {
    slug: "issues",
    group: "Insights",
    title: "Issues and priority",
    description: "How mentions are classified, grouped into issues and ranked.",
    Body: () => (
      <>
        <p>On paid plans, Heardex turns relevant mentions into issues: one issue per problem or request, with every post behind it. They&apos;re on the Issues page, and Insights goes deeper into each one.</p>
        <h2>Classification</h2>
        <p>Each relevant mention gets a sentiment (positive, negative, neutral or mixed) and a category:</p>
        <ul>
          <li>Bug report, performance issue, security concern</li>
          <li>Feature request</li>
          <li>Usability complaint, pricing complaint</li>
          <li>Support question, comparison with a competitor, praise, general discussion</li>
        </ul>
        <p>Classification is done by AI and can be wrong. You can correct any mention; the correction is kept along with the history of earlier ones.</p>
        <h2>Grouping into issues</h2>
        <p>Mentions that describe the same thing in different words are grouped into one issue. Each issue shows its reach (how many people), platforms, when it started, its trend and its priority.</p>
        <h2>Priority</h2>
        <p>Priority starts from what was measured: the number of distinct people reporting it, whether it&apos;s growing, and whether it keeps coming back. What the AI inferred, such as how severe it seems and which area of the product it affects, is shown separately. Claude can read the full reasoning through the <A href="/docs/mcp">connector</A>.</p>
        <h2>Working through issues</h2>
        <p>Mark an issue acknowledged, resolved or dismissed. On any issue, “Investigate with Claude” sends it to your own Claude to look for the cause in your code.</p>
      </>
    ),
  },
  {
    slug: "analytics",
    group: "Insights",
    title: "Analytics, spikes and reports",
    description: "Buzz analytics, how spikes are detected, and the weekly report.",
    Body: ({ plans }) => (
      <>
        <h2>Trends</h2>
        <p>The Trends page shows mention volume, sentiment and platforms over any date range. Every chart is built from stored mentions, so you can open any point to see the posts behind it. Periods that weren&apos;t fully monitored are labelled. Times are shown in your own time zone.</p>
        <Shot shot="trends" spots={[
          { x: 32.6, y: 25.3, at: [25, 27], label: "The period's mentions.", text: "Duplicates and reposts not counted, with unique authors and engagement." },
          { x: 52.8, y: 16.3, at: [69, 31], label: "Compared with before.", text: "Today, the last 24 hours, 7 days and 30 days against the period before." },
          { x: 34.2, y: 55.3, at: [26.5, 57], label: "Activity.", text: "All activity or one platform." },
          { x: 54.9, y: 55.3, at: [44, 57], label: "Range.", text: "24 hours, 7, 30 or 90 days, or your own dates." },
          { x: 69.4, y: 73.7, at: [46, 72], label: "Mentions over time.", text: "By publication day; open it as a table." },
        ]} />
        <h2>Spikes</h2>
        <p>Each day and hour is compared with its own baseline of fully monitored periods, allowing for normal weekday and time-of-day patterns. There&apos;s no fixed mention threshold: a spike is judged against your product&apos;s usual level.</p>
        <ul>
          <li><strong>Confirmed:</strong> very unlikely to be chance, on a fully monitored period with at least 7 days (for days) or 48 hours (for hours) of baseline.</li>
          <li><strong>Possible:</strong> unusual, but the period was only partly monitored or the baseline is short.</li>
          <li><strong>Not enough data:</strong> less than 3 days (or 12 hours) of fully monitored baseline.</li>
        </ul>
        <p>Spikes come with the platforms, keywords and posts that caused them.</p>
        <h2>Reports</h2>
        <ul>
          <li>Weekly reports on {plans.filter((p) => p.features.weekly_reports).map((p) => p.name).join(", ")}; daily summaries on {plans.filter((p) => p.features.daily_reports).map((p) => p.name).join(", ")}.</li>
          <li>Every Monday a report on the week before is emailed to each member who has it on. Turn it on or off in Settings → Account.</li>
          <li>Reports can be printed and exported as CSV.</li>
        </ul>
      </>
    ),
  },
  {
    slug: "mcp",
    group: "Insights",
    title: "Connect Claude, ChatGPT, Cursor and more (MCP)",
    description: "Connect Claude, Claude Code, ChatGPT, Cursor, VS Code or another MCP client to read your feedback and investigate issues.",
    Body: ({ mcpUrl }) => {
      const cursorConfig = btoa(JSON.stringify({ url: mcpUrl }));
      const cursorInstall = `https://cursor.com/en/install-mcp?name=heardex&config=${encodeURIComponent(cursorConfig)}`;
      const vscodeInstall = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "heardex", type: "http", url: mcpUrl }))}`;
      return (
      <>
        <p>The Heardex connector lets an AI app read your workspace&apos;s products, issues, the posts behind them and spike analysis. It can&apos;t change your settings or your data. The only things it can write are investigation reports and progress updates for developer-agent tasks you start yourself. It&apos;s included on every plan; the AI app&apos;s usage counts toward your own plan with that app.</p>
        <p>Every app uses the same address, and signs in to Heardex the same way: you approve one workspace, and the app can only see that workspace.</p>
        <pre><code>{mcpUrl}</code></pre>
        <h2>Claude on the web and the desktop app</h2>
        <Shot shot="claude" spots={[
          { x: 34.9, y: 66.3, at: [26.5, 69], label: "Settings → Claude.", text: "Where the connector lives." },
          { x: 46, y: 45, at: [42, 47], label: "Connect Claude.", text: "Three steps: copy Heardex's address, add it in Claude as a custom connector, approve access." },
          { x: 96.3, y: 51.7, at: [76, 61], label: "Things to ask.", text: "Examples written for your own product." },
        ]} />
        <ol>
          <li>In Heardex, open Settings → Claude and click Connect Claude. Copy the address it shows, add it in Claude as a custom connector, then approve access for your workspace.</li>
          <li>Or add it by hand: in Claude, go to Customize → Connectors → Add → Custom connector and paste the address above. Leave the advanced OAuth settings empty.</li>
        </ol>
        <p>On Claude Team and Enterprise plans, an owner adds the connector for the organization first, then each member connects it. Free Claude plans can add one custom connector.</p>
        <h2>Claude Code</h2>
        <pre><code>{`claude mcp add --transport http heardex ${mcpUrl}`}</code></pre>
        <p>Then run <code>/mcp</code> in Claude Code to sign in to Heardex.</p>
        <h2>ChatGPT</h2>
        <ol>
          <li>In ChatGPT, open Settings → Apps &amp; Connectors → Advanced settings and turn on Developer mode. This needs a paid ChatGPT plan, and on Business and Enterprise plans an admin may have to allow it.</li>
          <li>Back in Apps &amp; Connectors, click Create. Name it Heardex, paste the address above, choose OAuth, and save.</li>
          <li>Sign in to Heardex when asked and approve your workspace. In a new chat, add Heardex from the + menu.</li>
        </ol>
        <h2>Cursor</h2>
        <p><a href={cursorInstall}>Add Heardex to Cursor</a>, or add it to <code>~/.cursor/mcp.json</code> yourself:</p>
        <pre><code>{JSON.stringify({ mcpServers: { heardex: { url: mcpUrl } } }, null, 2)}</code></pre>
        <p>Then open Cursor Settings → MCP and click Connect next to Heardex to sign in.</p>
        <h2>VS Code (GitHub Copilot)</h2>
        <p><a href={vscodeInstall}>Add Heardex to VS Code</a>, or add it to <code>.vscode/mcp.json</code> in your project:</p>
        <pre><code>{JSON.stringify({ servers: { heardex: { type: "http", url: mcpUrl } } }, null, 2)}</code></pre>
        <p>Start the server from the file or the MCP view, sign in to Heardex, then use it from Copilot Chat in agent mode.</p>
        <h2>Other MCP clients</h2>
        <p>Any client that supports remote MCP servers over Streamable HTTP with OAuth sign-in can connect with the same address, as long as it signs in through a callback Heardex recognises: one of the apps above, or a loopback address on your own computer. If an app is refused, email <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> and say which one.</p>
        <p>To check the connection on its own, run <code>npx @modelcontextprotocol/inspector</code>, choose Streamable HTTP, paste the address and connect. It signs in the same way and lists the tools.</p>
        <h2>What the app can read</h2>
        <ul>
          <li><code>get_product_context</code>: your products, websites, aliases and competitors</li>
          <li><code>get_feedback_issues</code>: issues, highest priority first</li>
          <li><code>get_issue_details</code> and <code>get_issue_evidence</code>: one issue and the posts behind it</li>
          <li><code>get_issue_priority</code>: how its priority was decided, measured facts apart from AI inferences</li>
          <li><code>get_spike_analysis</code>: recent spikes and their explanations</li>
          <li><code>get_implementation_context</code>: what a coding agent needs about one issue</li>
        </ul>
        <h2>What it can write</h2>
        <p>Only for developer-agent tasks you start in Heardex: <code>get_agent_task</code> picks one up, <code>submit_investigation_report</code> sends its report back for you to review, and <code>report_implementation_status</code> reports progress on a plan you approved. Nothing is implemented without your approval.</p>
        <h2>Things to ask</h2>
        <ul>
          <li>“What are the top complaints about my product this week?”</li>
          <li>“Summarize the bug reports and where they come from.”</li>
          <li>“Which platforms talk about us the most?”</li>
        </ul>
        <h2>Revoking access</h2>
        <p>Settings → Claude lists every app approved for the workspace. Revoke one, or disconnect, and access stops at once.</p>
      </>
      );
    },
  },
  {
    slug: "billing",
    group: "Account",
    title: "Plans and billing",
    description: "Prices, monthly or yearly billing, changing plan, cancelling and refunds.",
    Body: ({ plans }) => (
      <>
        <PlanTable plans={plans} cols={[
          ["Monthly", (p) => (p.priceCentsMonthly ? `${formatPrice(p.priceCentsMonthly, p.currency)}/month` : "Free")],
          ["Yearly", (p) => (p.priceCentsYearly ? `${formatPrice(p.priceCentsYearly, p.currency)}/year (${formatPrice(intervalPrice(p, "year").perMonthCents, p.currency)}/month)` : "—")],
          ["Keywords", (p) => n(p.maxKeywords)],
          ["Mentions a month", (p) => n(p.monthlyMentionLimit)],
        ]} />
        <p>Prices are in US dollars, plus any sales tax shown at checkout.</p>
        <h2>Paying</h2>
        <p>Payments are handled by Dodo Payments, our merchant of record: it charges your card, sends your invoice and handles sales tax, VAT and GST. Heardex never sees your card details. Only the workspace owner can change the plan.</p>
        <h2>Changing plan or billing</h2>
        <p>In Settings → Billing, pick Monthly or Yearly and choose a plan. A change applies straight away, and you pay or are credited the difference for the rest of the period.</p>
        <h2>If a payment fails</h2>
        <p>Dodo retries it and you keep your plan for a grace period. If it still fails, the workspace moves to Free limits until the payment is made; your data is kept. Update your card from Settings → Billing → Manage billing.</p>
        <h2>Cancelling and refunds</h2>
        <p>Cancel any time from Settings → Billing → Manage billing. You keep your plan until the end of what you paid for, then move to Free. See the <A href="/legal/refunds">refund policy</A>.</p>
      </>
    ),
  },
];

export const docBySlug = (slug: string) => DOCS.find((d) => d.slug === slug);
export const DOC_GROUPS = ["Start", "Monitoring", "Insights", "Account"] as const;
