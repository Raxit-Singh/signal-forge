// Blog posts (src/app/blog). A post is an entry here with its body as JSX. No invented numbers, customers or quotes:
// guides describe how to do something, with Heardex where it helps; claims about Heardex match the docs.
import Link from "next/link";

export const BLOG_CATEGORIES = ["Guides", "Product", "Insights"] as const;
export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

export interface Post {
  slug: string;
  title: string;
  description: string;
  category: BlogCategory;
  /** ISO date. */
  date: string;
  minutes: number;
  Body: () => React.ReactNode;
}

const A = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href}>{children}</Link>;

export const POSTS: Post[] = [
  {
    slug: "turn-reddit-and-hacker-news-complaints-into-a-bug-list",
    title: "Turn Reddit and Hacker News complaints into a ranked bug list",
    description: "Users report bugs in public long before they email support. Here's how to find those posts, group them and decide what to fix first.",
    category: "Guides",
    date: "2026-11-04",
    minutes: 6,
    Body: () => (
      <>
        <p>When something breaks in your product, the first report is rarely a support ticket. It&apos;s a Reddit comment asking whether anyone else has the problem, a Hacker News reply mentioning that your export &ldquo;still falls over&rdquo;, a one-star App Store review, or a GitHub issue on a project that depends on you. By the time it reaches your inbox, many more people have hit it and said nothing to you.</p>
        <p>This guide shows how to collect those posts, group them into issues and rank them, by hand first and then with Heardex.</p>

        <h2>1. Search where your users already talk</h2>
        <p>Start with the places people go when something doesn&apos;t work:</p>
        <ul>
          <li><strong>Reddit:</strong> the subreddit for your category, and posts where people compare tools.</li>
          <li><strong>Hacker News:</strong> launch threads and &ldquo;Ask HN&rdquo; posts where your product comes up.</li>
          <li><strong>GitHub:</strong> issues in projects that integrate with yours.</li>
          <li><strong>Stack Overflow:</strong> questions about your API or SDK.</li>
          <li><strong>App store reviews:</strong> the most direct bug reports you&apos;ll get, and the least read.</li>
        </ul>
        <p>Search for your product&apos;s name, its short forms and common misspellings. If your name is a common word, add context: your domain, or words that only appear next to your product.</p>

        <h2>2. Keep only what&apos;s about you</h2>
        <p>A product called &ldquo;Notes&rdquo; matches every post about notes. Before anything else, throw out posts that aren&apos;t about your product. It&apos;s tedious but it decides whether the rest is useful.</p>

        <h2>3. Sort each post</h2>
        <p>Give each remaining post a category. A small set is enough:</p>
        <ul>
          <li>Bug, performance problem or security concern</li>
          <li>Feature request</li>
          <li>Complaint about usability or pricing</li>
          <li>Question, praise, or comparison with a competitor</li>
        </ul>

        <h2>4. Group posts about the same problem</h2>
        <p>Ten people describe the same crash in ten ways: &ldquo;export freezes&rdquo;, &ldquo;PDF never finishes&rdquo;, &ldquo;lost my work saving a long doc&rdquo;. Group them into one issue and keep every post behind it. The count of distinct people is the most useful number you&apos;ll have.</p>

        <h2>5. Rank by evidence, not by volume of noise</h2>
        <p>Rank issues on things you can measure:</p>
        <ul>
          <li><strong>Reach:</strong> how many different people reported it.</li>
          <li><strong>Trend:</strong> is it growing this week compared with the last few?</li>
          <li><strong>Recurrence:</strong> does it keep coming back after you thought it was fixed?</li>
        </ul>
        <p>Severity and which part of the product it touches matter too, but they&apos;re judgement calls. Keep them separate from the measured facts so you know which is which.</p>

        <h2>Doing it with Heardex</h2>
        <p>Heardex does these steps continuously. Add your product and keywords, and it searches Reddit, Hacker News, GitHub, Stack Overflow, app store reviews and more, checks each post is about your product, classifies it and groups similar posts into issues. Issues are ranked from reach, trend and recurrence, with the AI&apos;s inferences shown apart. See <A href="/product/feedback-intelligence">Feedback intelligence</A> and <A href="/docs/issues">how issues are ranked</A>.</p>
        <p>From an issue, &ldquo;Investigate with Claude&rdquo; hands it to your own Claude, which reads every report and looks for the cause in your code. That&apos;s the step from &ldquo;people are complaining&rdquo; to &ldquo;here&apos;s the line that breaks&rdquo;.</p>

        <h2>A weekly habit</h2>
        <p>Whatever tools you use, look at the list once a week: what&apos;s new, what&apos;s growing, what came back. Fix the top one, reply to the people who reported it, and mark it resolved. Public bug reports are a gift: people telling you exactly what to fix, for free.</p>
      </>
    ),
  },
  {
    slug: "ask-claude-what-your-users-are-saying",
    title: "Ask Claude what your users are saying",
    description: "Connect Heardex to Claude and ask about your feedback in plain words, or send an issue to Claude Code to find the cause.",
    category: "Product",
    date: "2026-11-04",
    minutes: 4,
    Body: () => (
      <>
        <p>Dashboards are good for a weekly look. For a quick question (&ldquo;what are people angry about since Tuesday&apos;s release?&rdquo;) it&apos;s faster to ask. The Heardex connector lets Claude read your feedback and answer from your real data.</p>

        <h2>What Claude can see</h2>
        <p>Claude reads through the Model Context Protocol (MCP), with access you approve for one workspace. It can read your products and competitors, issues in priority order, the posts behind each issue, how each priority was decided, and recent spikes with their explanations. It&apos;s read-only: Claude can&apos;t change anything in Heardex.</p>

        <h2>Connect it</h2>
        <ol>
          <li>In Heardex, open Settings → Claude and click Connect.</li>
          <li>Approve access for your workspace.</li>
          <li>Open Claude and ask.</li>
        </ol>
        <p>In Claude Code, add it with one command and sign in with <code>/mcp</code>. The <A href="/docs/mcp">docs</A> have the exact URL and steps for Team and Enterprise plans.</p>

        <h2>Questions that work well</h2>
        <ul>
          <li>&ldquo;What are the top complaints this week, and where do they come from?&rdquo;</li>
          <li>&ldquo;Summarize the bug reports about export.&rdquo;</li>
          <li>&ldquo;Which feature requests are growing?&rdquo;</li>
          <li>&ldquo;Why did mentions spike yesterday?&rdquo;</li>
          <li>&ldquo;What do people say about us compared with our competitors?&rdquo;</li>
        </ul>
        <p>Claude answers with links to the posts, so you can check anything that surprises you.</p>

        <h2>From an issue to the fix</h2>
        <p>On any issue in Heardex, &ldquo;Investigate with Claude&rdquo; opens Claude with that issue ready. In Claude Code, working in your repository, Claude reads every report, looks for the cause and suggests a fix. It asks before changing anything, and nothing is written back to Heardex.</p>

        <h2>Included on every plan</h2>
        <p>The connector is on every Heardex plan, Free included. Claude usage counts toward your own Claude plan. See <A href="/product/mcp">Heardex MCP</A>.</p>
      </>
    ),
  },
  {
    slug: "where-software-users-report-problems",
    title: "Where software users report problems (and why support never hears about most of them)",
    description: "Most people who hit a bug don't contact you. Here's where they go instead, and how to listen there.",
    category: "Insights",
    date: "2026-11-04",
    minutes: 5,
    Body: () => (
      <>
        <p>If you only read your support inbox, you only hear from the people who decided to contact you. That&apos;s a small and unusual group: they cared enough to write, knew where to write, and believed someone would answer. Everyone else who hit the same problem either worked around it, gave up quietly, or said so somewhere else.</p>

        <h2>Where they go instead</h2>
        <h3>App store reviews</h3>
        <p>For mobile apps, reviews are where bug reports go to be ignored. They&apos;re short, angry and specific: &ldquo;crashes when I open a shared file&rdquo;. Read them the way you&apos;d read a bug tracker.</p>
        <h3>Reddit and Hacker News</h3>
        <p>People ask whether others have the same problem, compare you with alternatives, and recommend workarounds. Threads here also show which complaints change people&apos;s minds about a product, which is useful for deciding priority.</p>
        <h3>GitHub and Stack Overflow</h3>
        <p>For developer tools, problems show up as issues in projects that use you and questions about your API. They often include a reproduction, which is worth more than any number of complaints.</p>
        <h3>X, LinkedIn, Bluesky and TikTok</h3>
        <p>Fast, public and short-lived. Good for spotting a problem right after a release, and for seeing how far a complaint is spreading.</p>

        <h2>Why it&apos;s hard to keep up</h2>
        <ul>
          <li><strong>It&apos;s scattered.</strong> Each place has its own search, and some barely have one.</li>
          <li><strong>Names are ambiguous.</strong> If your product shares a name with a common word, most results aren&apos;t about you.</li>
          <li><strong>The same problem looks different every time.</strong> Without grouping, ten reports of one bug look like ten small things.</li>
          <li><strong>History is limited.</strong> Some platforms only search the last month, so if you don&apos;t look regularly, posts are hard to find later.</li>
        </ul>

        <h2>How to listen without reading everything</h2>
        <ol>
          <li>Pick the places your users actually are, not every network.</li>
          <li>Search for every name people use for your product, and filter out what isn&apos;t about you.</li>
          <li>Group posts by problem, and count distinct people, not posts.</li>
          <li>Look at the list weekly; react the same day to anything that spikes.</li>
        </ol>
        <p>Heardex does this for you across <A href="/docs/platforms">these platforms</A>, and turns it into a ranked list of issues. Start on the free plan and see what people already say about your product.</p>
      </>
    ),
  },
];

export const postBySlug = (slug: string) => POSTS.find((p) => p.slug === slug);
export const formatPostDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
