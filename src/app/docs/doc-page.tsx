import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { planFromRow, type PlanRow } from "@/lib/domain/plans";
import { resourceUrl } from "@/lib/agent/oauth";
import { site } from "@/lib/server/agent/http";
import { DOCS, type Doc } from "@/content/docs";
import { Words } from "@/components/landing/words";

/** One docs page: its body with the live plans, and links to the pages before and after it. */
export async function DocPage({ doc }: { doc: Doc }) {
  const { data } = await (await createClient()).from("plans").select("*").eq("is_public", true).order("sort_order");
  const plans = (data ?? []).map((r) => planFromRow(r as PlanRow)).filter((p) => !p.retired);
  const i = DOCS.indexOf(doc);
  const href = (d: Doc) => (d.slug ? `/docs/${d.slug}` : "/docs");
  const prev = DOCS[i - 1];
  const next = DOCS[i + 1];
  return (
    // Keyed by page, so the title comes into focus again on every docs page, not only the first.
    <article key={doc.slug} className="max-w-[860px]">
      <p className="hx-in text-[14px] font-medium text-[var(--red)]">{doc.group}</p>
      <h1 className="hx-title mt-3 text-[clamp(34px,4.4vw,60px)] font-semibold leading-[1] tracking-[-0.04em]"><Words text={doc.title} from="start" /></h1>
      <p className="hx-in mt-4 max-w-[60ch] text-[length:var(--step-lead)] leading-snug text-[var(--muted)]" style={{ ["--d" as string]: "380ms" }}>{doc.description}</p>
      <div className="hx-prose hx-in mt-[clamp(64px,9vh,104px)] max-w-[760px]" style={{ ["--d" as string]: "560ms" }}>{doc.Body({ plans, mcpUrl: resourceUrl(site()) })}</div>
      <nav aria-label="More docs" className="hx-glow-group hx-rise mt-16 grid max-w-[760px] gap-3 border-t border-[var(--line)] pt-8 sm:grid-cols-2">
        {prev ? <Link href={href(prev)} className="hx-alt-card hx-glow"><span className="text-[13px] text-[var(--muted)]">← Previous</span><span className="mt-1 block font-medium">{prev.title}</span></Link> : <span />}
        {next && <Link href={href(next)} className="hx-alt-card hx-glow text-right"><span className="text-[13px] text-[var(--muted)]">Next →</span><span className="mt-1 block font-medium">{next.title}</span></Link>}
      </nav>
    </article>
  );
}
