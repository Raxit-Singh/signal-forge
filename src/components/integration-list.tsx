import Link from "next/link";
import { Ban, Clock, CreditCard, FlaskConical, Globe, KeyRound, Lock, MessagesSquare } from "lucide-react";
import { INTEGRATIONS, type IntegrationInfo } from "@/lib/domain/integrations";
import { Badge } from "@/components/ui/primitives";

export interface LiveStatus {
  tone: "positive" | "warning" | "negative" | "neutral";
  label: string;
  lines: string[];
  /** Relevant mentions this source found for the product in the last 30 days. */
  found?: number;
  /** Mentions page filtered to this source. */
  href?: string;
}

const COMMENTS: Record<NonNullable<IntegrationInfo["commentCoverage"]>, string> = {
  search: "Comments: searched directly",
  selected_posts: "Comments: selected posts only",
  none: "No comments",
};

function Status({ info, live }: { info: IntegrationInfo; live?: LiveStatus }) {
  const implemented = info.availability === "available" || info.availability === "unverified";
  if (implemented && live) return <Badge tone={live.tone}>{live.label}</Badge>;
  if (info.availability === "available") return <Badge tone="positive">Available</Badge>;
  if (info.availability === "unverified") {
    return <Badge tone="info"><FlaskConical className="size-3" aria-hidden />Built · not yet verified live</Badge>;
  }
  if (info.availability === "blocked") return <Badge tone="neutral"><Ban className="size-3" aria-hidden />Unavailable</Badge>;
  return <Badge tone="info"><Clock className="size-3" aria-hidden />In development{info.milestone ? ` · M${info.milestone}` : ""}</Badge>;
}

/** Honest catalog of data sources with what each can access. */
export function IntegrationList({ compact = false, live }: { compact?: boolean; live?: Record<string, LiveStatus> }) {
  const supported = INTEGRATIONS.filter((i) => i.availability !== "blocked");
  const blocked = INTEGRATIONS.filter((i) => i.availability === "blocked");
  return (
    <div className="grid gap-4">
      <ul className="divide-y rounded-md border">
        {supported.map((i) => (
          <li key={i.provider} className="grid gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{i.name}</span>
              <Status info={i} live={live?.[i.provider]} />
              <span className="ml-auto flex flex-wrap gap-1">
                {i.paid && <Badge><CreditCard className="size-3" aria-hidden />Paid source</Badge>}
                {i.commentCoverage && <Badge><MessagesSquare className="size-3" aria-hidden />{COMMENTS[i.commentCoverage]}</Badge>}
                {i.publicDiscovery && <Badge><Globe className="size-3" aria-hidden />Public discovery</Badge>}
                {i.requiresAuthorization && <Badge><KeyRound className="size-3" aria-hidden />Needs your authorization</Badge>}
                {i.readOnly && <Badge><Lock className="size-3" aria-hidden />Read-only</Badge>}
              </span>
            </div>
            <p className="text-[13px]">{i.dataAccessed}</p>
            {live?.[i.provider]?.found !== undefined && (
              <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]" data-testid={`source-found-${i.provider}`}>
                <span><span className="font-semibold tabular">{live[i.provider]!.found!.toLocaleString("en-US")}</span> relevant mention{live[i.provider]!.found === 1 ? "" : "s"} in the last 30 days</span>
                {live[i.provider]!.found! > 0 && live[i.provider]!.href && (
                  <Link href={live[i.provider]!.href!} className="text-xs underline underline-offset-4">View them</Link>
                )}
              </p>
            )}
            {live?.[i.provider]?.lines.map((l) => (
              <p key={l} className="text-xs text-muted-foreground">{l}</p>
            ))}
            {!compact && (
              <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-[110px_1fr]">
                <dt className="font-medium">Permissions</dt>
                <dd>{i.permissions}</dd>
                <dt className="font-medium">Limits</dt>
                <dd>{i.limits}</dd>
              </dl>
            )}
          </li>
        ))}
      </ul>
      <details className="rounded-md border p-3 text-[13px]">
        <summary className="cursor-pointer font-medium">Why not Threads, Slack or Product Hunt?</summary>
        <ul className="mt-2 grid gap-1.5 text-muted-foreground">
          {blocked.map((i) => (
            <li key={i.provider}><span className="font-medium text-foreground">{i.name}:</span> {i.blockedReason}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
