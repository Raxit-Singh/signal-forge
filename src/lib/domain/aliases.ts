// Search-keyword suggestions for a product. Pure; unit-tested with `node --test`.
//
// Principle: suggestions are a starting point the user edits. Anything that
// could easily match unrelated conversations is flagged ambiguous and needs
// context terms before the matcher will trust it.

export type AliasKind = "exact_name" | "abbreviation" | "domain" | "misspelling" | "handle" | "custom";

export interface AliasSuggestion {
  term: string;
  kind: AliasKind;
  isAmbiguous: boolean;
  contextTerms: string[];
  negativeTerms: string[];
  enabled: boolean;
  reason: string;
}

export interface AliasInput {
  name: string;
  websiteDomain?: string | null;
  githubRepo?: string | null; // owner/repo
  category?: string | null;
  description?: string | null;
  handles?: string[];
}

// Common English / software words that are product names in the wild
// ("Linear", "Notion", "Arc", "Raycast"...). Matching these alone produces noise.
const COMMON_WORDS = new Set(
  `a an the and or but if of to in on at by for with from up down out over under again
  about above after before between into through during app apps tool tools linear notion
  arc slack figma loom zoom stripe vercel render railway fly supabase clerk resend sentry
  bolt cursor replit warp raycast obsidian bear things craft amplify mercury ramp brex
  pilot copilot jira asana monday trello basecamp height plane cal calendar mail inbox
  note notes task tasks todo focus flow pulse signal spark beam beacon bridge cloud core
  data dash deck docs drive edge forge frame grid hub hive keep lens link loop map mesh
  mint nest node nova orbit page path peak pixel point port post press prism pro quest
  rally ray reach relay ridge rise root scout shift snap sol space spot stack stage star
  stream studio sync tab tide track trail vault verse vibe view wave way wise work zen
  apple amazon meta google chrome safari edge open close run go play home office team
  chat talk meet base basic simple smart quick swift rust ruby python java kotlin dart
  go elixir deno bun node react vue svelte angular next nuxt remix astro solid tailwind
  linear notion attio coda airtable retool bubble webflow framer wix squarespace shopify
  ghost medium substack buffer hootsuite canva miro mural whimsical pitch keynote numbers
  pages word excel teams outlook bing yahoo duck brave opera vivaldi firefox`
    .split(/\s+/)
    .filter(Boolean),
);

const STOPWORDS = new Set(
  `a an the and or but if of to in on at by for with from is are be your you our we it this that
  app apps tool tools platform software product service simple easy fast best new more all any
  helps help make makes get using use used built build way ways who what when where how`
    .split(/\s+/)
    .filter(Boolean),
);

/** Splits CamelCase / snake / kebab / spaces into words. */
export function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** A term is ambiguous if it is short or a common word on its own. */
export function isAmbiguousTerm(term: string): boolean {
  const t = term.trim().toLowerCase();
  if (t.length <= 4 && !t.includes(".")) return true;
  const words = splitWords(term).map((w) => w.toLowerCase());
  if (words.length === 1 && COMMON_WORDS.has(words[0] ?? "")) return true;
  // Two common words joined as one token ("FocusFlow") is usually distinctive;
  // but separated ("Focus Flow") reads like a normal phrase.
  if (/\s/.test(term.trim()) && words.every((w) => COMMON_WORDS.has(w) || STOPWORDS.has(w))) return true;
  return false;
}

/**
 * For keywords a user types in: besides known-ambiguous terms, a single plain
 * lowercase word ("timer", "whiteboard") is treated as ambiguous by default —
 * it usually appears in unrelated posts. Users can override it.
 */
export function isAmbiguousCustomTerm(term: string): boolean {
  return isAmbiguousTerm(term) || /^[a-z]+$/.test(term.trim());
}

/** Up to `limit` distinctive keywords from category/description for context filtering. */
export function contextKeywords(input: Pick<AliasInput, "category" | "description" | "name">, limit = 6): string[] {
  const nameWords = new Set(splitWords(input.name).map((w) => w.toLowerCase()));
  const text = `${input.category ?? ""} ${input.description ?? ""}`.toLowerCase();
  const counts = new Map<string, number>();
  for (const raw of text.split(/[^a-z0-9+#]+/)) {
    const w = raw.trim();
    if (w.length < 3 || STOPWORDS.has(w) || nameWords.has(w) || /^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

function push(list: AliasSuggestion[], s: AliasSuggestion) {
  const key = s.term.toLowerCase();
  if (s.term.trim().length < 2 || s.term.length > 100) return;
  if (list.some((x) => x.term.toLowerCase() === key)) return;
  list.push(s);
}

export function suggestAliases(input: AliasInput): AliasSuggestion[] {
  const name = input.name.trim();
  const out: AliasSuggestion[] = [];
  if (!name) return out;

  const ctx = contextKeywords(input);
  if (input.websiteDomain) ctx.unshift(input.websiteDomain.toLowerCase());
  const contextTerms = [...new Set(ctx)].slice(0, 8);

  const ambiguousName = isAmbiguousTerm(name);
  push(out, {
    term: name,
    kind: "exact_name",
    isAmbiguous: ambiguousName,
    contextTerms: ambiguousName ? contextTerms : [],
    negativeTerms: [],
    // An ambiguous name with no context available stays disabled until the user adds some.
    enabled: !ambiguousName || contextTerms.length > 0,
    reason: ambiguousName
      ? "Common or short word — only counted when a context term also appears."
      : "Your product name.",
  });

  const words = splitWords(name);
  if (words.length > 1) {
    const spaced = words.join(" ");
    const hyphen = words.join("-").toLowerCase();
    const joined = words.join("");
    for (const variant of [spaced, hyphen, joined]) {
      if (variant.toLowerCase() === name.toLowerCase()) continue;
      const amb = isAmbiguousTerm(variant);
      push(out, {
        term: variant,
        kind: "misspelling",
        isAmbiguous: amb,
        contextTerms: amb ? contextTerms : [],
        negativeTerms: [],
        enabled: !amb || contextTerms.length > 0,
        reason: "Spacing variant people commonly type.",
      });
    }
    const initials = words.map((w) => w[0]).join("").toUpperCase();
    if (initials.length >= 2) {
      push(out, {
        term: initials,
        kind: "abbreviation",
        isAmbiguous: true,
        contextTerms,
        negativeTerms: [],
        enabled: false, // initials collide with everything; opt-in only
        reason: "Initials are rarely unique — enable only if your users actually say this.",
      });
    }
  }

  if (input.websiteDomain) {
    push(out, {
      term: input.websiteDomain.toLowerCase(),
      kind: "domain",
      isAmbiguous: false,
      contextTerms: [],
      negativeTerms: [],
      enabled: true,
      reason: "Links to your site are a strong signal.",
    });
  }

  if (input.githubRepo) {
    push(out, {
      term: input.githubRepo,
      kind: "custom",
      isAmbiguous: false,
      contextTerms: [],
      negativeTerms: [],
      enabled: true,
      reason: "References to your repository.",
    });
  }

  for (const h of input.handles ?? []) {
    const handle = h.trim().replace(/^@?/, "@");
    if (!/^@[A-Za-z0-9_.]{2,50}$/.test(handle)) continue;
    push(out, {
      term: handle,
      kind: "handle",
      isAmbiguous: false,
      contextTerms: [],
      negativeTerms: [],
      enabled: true,
      reason: "Official social handle.",
    });
  }

  return out;
}

interface BrandAlias { term: string; kind: string; isAmbiguous: boolean; contextTerms: string[]; negativeTerms: string[]; enabled: boolean; source: string }

/**
 * The product name is always a monitored brand term: added if missing and
 * switched on if it was off — except an ambiguous name without context words,
 * which stays off until context is added (it would match unrelated posts).
 */
export function ensureBrandTerm<T extends BrandAlias>(aliases: T[], productName: string): { aliases: T[]; changed: boolean } {
  const name = productName.trim();
  if (name.length < 2) return { aliases, changed: false };
  const i = aliases.findIndex((a) => a.term.trim().toLowerCase() === name.toLowerCase());
  if (i === -1) {
    const ambiguous = isAmbiguousTerm(name);
    const brand = { term: name, kind: "exact_name", isAmbiguous: ambiguous, contextTerms: [], negativeTerms: [], enabled: !ambiguous, source: "suggested" } as unknown as T;
    return { aliases: [brand, ...aliases], changed: true };
  }
  const a = aliases[i]!;
  const usable = !(a.isAmbiguous && a.contextTerms.length === 0);
  if (a.enabled || !usable) return { aliases, changed: false };
  return { aliases: aliases.map((x, j) => (j === i ? { ...x, enabled: true } : x)), changed: true };
}

export function isBrandTerm(term: string, productName: string): boolean {
  return term.trim().toLowerCase() === productName.trim().toLowerCase();
}

/**
 * Keeps the keyword list in step with a product edit: the old product name is
 * replaced by the new one (it is what every platform searches for), and a
 * domain keyword for the old website follows the new website. Nothing else is
 * touched; the new name is then made sure of like any brand term.
 */
export function retargetBrandAliases<T extends BrandAlias>(
  aliases: T[],
  before: { name: string; domain: string | null },
  after: { name: string; domain: string | null },
): { aliases: T[]; changed: boolean } {
  const same = (a: string, b: string | null) => b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
  let out = [...aliases];
  let changed = false;
  if (!same(before.name, after.name)) {
    const i = out.findIndex((a) => same(a.term, before.name));
    if (i !== -1) {
      changed = true;
      if (out.some((a) => same(a.term, after.name))) out.splice(i, 1);
      else {
        const ambiguous = isAmbiguousTerm(after.name.trim());
        out[i] = { ...out[i]!, term: after.name.trim(), isAmbiguous: ambiguous, contextTerms: [], negativeTerms: [], enabled: !ambiguous };
      }
    }
  }
  if (before.domain && !same(before.domain, after.domain)) {
    const i = out.findIndex((a) => a.kind === "domain" && same(a.term, before.domain));
    if (i !== -1) {
      changed = true;
      if (!after.domain || out.some((a) => same(a.term, after.domain))) out.splice(i, 1);
      else out[i] = { ...out[i]!, term: after.domain };
    }
  }
  const ensured = ensureBrandTerm(out, after.name);
  out = ensured.aliases;
  return { aliases: out, changed: changed || ensured.changed };
}
