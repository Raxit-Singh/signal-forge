"use client";

import { useActionState, useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Input } from "@/components/ui/primitives";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { idle } from "@/lib/action-state";
import { saveAliasesAction } from "@/app/actions/product";
import { isAmbiguousCustomTerm, isBrandTerm, type AliasKind } from "@/lib/domain/aliases";
import { overAllowanceReason as overReason, type KeywordAllowance } from "@/lib/domain/keyword-allowance";
import { cn } from "@/lib/utils";

export interface EditableAlias {
  term: string;
  kind: AliasKind;
  isAmbiguous: boolean;
  contextTerms: string[];
  negativeTerms: string[];
  enabled: boolean;
  source: "suggested" | "user";
  reason?: string;
}

const KIND_LABEL: Record<AliasKind, string> = {
  exact_name: "Name",
  abbreviation: "Abbreviation",
  domain: "Website",
  misspelling: "Variant",
  handle: "Handle",
  custom: "Custom",
};

function parseTerms(s: string) {
  return s.split(",").map((t) => t.trim()).filter((t) => t.length >= 2).slice(0, 20);
}

const joinTerms = (list: string[]) => list.join(", ");

export function KeywordEditor({
  productId, initial, mode, allowance, productName, contextSuggestions = [],
}: {
  productId: string; initial: EditableAlias[]; mode: "onboarding" | "settings"; allowance?: KeywordAllowance; productName?: string;
  /** One-click context words (the website's domain, words from the description). */
  contextSuggestions?: string[];
}) {
  const [aliases, setAliases] = useState<EditableAlias[]>(initial);
  // What the user typed in each keyword's two word boxes (kept as typed, so commas and spaces don't jump).
  const [typed, setTyped] = useState<Record<string, { context: string; skip: string }>>(() =>
    Object.fromEntries(initial.map((a) => [a.term, { context: joinTerms(a.contextTerms), skip: joinTerms(a.negativeTerms) }])));
  const [draft, setDraft] = useState("");
  const [state, action] = useActionState(saveAliasesAction, idle);
  const addId = useId();
  const owner = productName ?? "your product";

  const update = (i: number, patch: Partial<EditableAlias>) =>
    setAliases((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  /** Context words changed: a keyword waiting for its first one switches on when it arrives, and off when none are left. */
  const setContext = (i: number, text: string) => {
    const a = aliases[i]!;
    const terms = parseTerms(text);
    setTyped((t) => ({ ...t, [a.term]: { context: text, skip: t[a.term]?.skip ?? "" } }));
    update(i, { contextTerms: terms, enabled: terms.length === 0 ? false : a.enabled || a.contextTerms.length === 0 });
  };

  const add = () => {
    const term = draft.trim();
    if (term.length < 2 || aliases.some((a) => a.term.toLowerCase() === term.toLowerCase())) return;
    const amb = isAmbiguousCustomTerm(term);
    const full = Boolean(allowance) && aliases.filter((a) => a.enabled).length >= allowance!.available;
    setAliases((l) => [
      ...l,
      {
        term, kind: "custom", isAmbiguous: amb, contextTerms: [], negativeTerms: [], enabled: !amb && !full, source: "user",
        reason: !amb && full ? overReason(allowance!) : undefined,
      },
    ]);
    setTyped((t) => ({ ...t, [term]: { context: "", skip: "" } }));
    setDraft("");
  };

  const payload = JSON.stringify(
    aliases.map(({ reason: _reason, ...a }) => a),
  );
  const enabledCount = aliases.filter((a) => a.enabled).length;
  const atLimit = Boolean(allowance) && enabledCount >= allowance!.available;
  const overLimit = Boolean(allowance) && enabledCount > allowance!.available;
  // One keyword for this product and it's the product name (always on): adding others could never switch them on.
  const hasBrand = productName !== undefined && aliases.some((a) => isBrandTerm(a.term, productName));
  const onlyBrand = Boolean(allowance) && allowance!.available <= 1 && hasBrand && aliases.every((a) => isBrandTerm(a.term, productName!) || !a.enabled);
  const waiting = aliases.find((a) => a.isAmbiguous && a.contextTerms.length === 0 && (!onlyBrand || isBrandTerm(a.term, productName!)));
  // Why Save is greyed out, said next to it.
  const blocked = overLimit ? null
    : enabledCount === 0
      ? waiting ? `Add at least one word for “${waiting.term}” above to save.` : "Switch on at least one keyword to save."
      : null;

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="aliases" value={payload} />
      <FormMessage state={state} />

      <ul className="grid gap-2" aria-label="Keywords">
        {aliases.length === 0 && (
          <li className="rounded-2xl border border-dashed p-5 text-center text-[13px] text-muted-foreground">No keywords yet. Add at least one below.</li>
        )}
        {aliases.map((a, i) => {
          const needsContext = a.isAmbiguous && a.contextTerms.length === 0;
          // The product name is always monitored: it can't be removed or switched off (only given context words).
          const brand = productName !== undefined && isBrandTerm(a.term, productName);
          // On a one-keyword plan only the product name can be on; the rest stay saved (off) but aren't shown.
          if (onlyBrand && !brand) return null;
          const words = typed[a.term] ?? { context: joinTerms(a.contextTerms), skip: joinTerms(a.negativeTerms) };
          const offered = contextSuggestions.filter((w) => w.toLowerCase() !== a.term.toLowerCase() && !a.contextTerms.some((c) => c.toLowerCase() === w.toLowerCase()));
          return (
            <li key={a.term} className={cn("grid gap-3 rounded-2xl border p-3.5 transition-colors",
              a.enabled ? "border-foreground/[0.12] bg-foreground/[0.04]" : "border-foreground/[0.06] bg-transparent")}>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    checked={a.enabled}
                    disabled={needsContext || (!a.enabled && atLimit) || (brand && a.enabled)}
                    title={needsContext ? "Add a word below first" : !a.enabled && atLimit && allowance ? overReason(allowance) : brand ? "Your product name is always on" : undefined}
                    onChange={(e) => update(i, { enabled: e.target.checked })}
                    aria-label={`Listen for ${a.term}`}
                  />
                  <span className={cn("truncate text-[14px] font-medium", !a.enabled && "font-normal text-muted-foreground")}>{a.term}</span>
                </label>
                <Badge>{KIND_LABEL[a.kind]}</Badge>
                {brand && !needsContext && <Badge tone="info">Always on</Badge>}
                {needsContext && <Badge tone="warning">Needs a word to switch on</Badge>}
                <div className="ml-auto flex items-center gap-1">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    title="Tick this when the word also means something else (like “notion” or “abc”). It then counts only in posts that also contain a word you choose.">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-[var(--primary)]"
                      checked={a.isAmbiguous}
                      onChange={(e) =>
                        update(i, {
                          isAmbiguous: e.target.checked,
                          // The product name is on whenever it can be.
                          enabled: e.target.checked && a.contextTerms.length === 0 ? false : brand ? true : a.enabled,
                        })
                      }
                    />
                    Has other meanings
                  </label>
                  {/* The product name can't be removed, so it gets no remove button at all. */}
                  {!brand && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${a.term}`}
                      onClick={() => setAliases((l) => l.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
              {!a.isAmbiguous && a.reason && <p className="text-xs text-muted-foreground">{a.reason}</p>}
              {a.isAmbiguous && (
                <div className={cn("grid gap-3 rounded-xl p-3", needsContext ? "bg-warning/[0.07] ring-1 ring-warning/25" : "bg-foreground/[0.03]")}>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">“{a.term}” also means other things</span>, so on its own it would
                    collect posts that aren&apos;t about {owner}. Add a word people write next to it, such as your website, what {owner} does
                    or a feature name. Only posts that contain “{a.term}” <em>and</em> one of these words are collected.
                  </p>
                  <label className="grid gap-1.5 text-xs">
                    <span className="font-medium text-foreground">Collect a post only if it also contains</span>
                    <Input
                      value={words.context}
                      placeholder={contextSuggestions[0] ? `e.g. ${contextSuggestions.slice(0, 3).join(", ")}` : "e.g. yourproduct.com, app, the thing it does"}
                      aria-invalid={needsContext || undefined}
                      // Committed on every keystroke (not blur) so the switch above is never stale.
                      onChange={(e) => setContext(i, e.target.value)}
                    />
                    <span className="text-muted-foreground">Separate words with commas. One match is enough.</span>
                  </label>
                  {offered.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">Suggestions:</span>
                      {offered.map((w) => (
                        <button key={w} type="button"
                          onClick={() => setContext(i, [...a.contextTerms, w].join(", "))}
                          className="press flex h-7 items-center gap-1 rounded-full border border-foreground/[0.12] px-2.5 text-foreground transition-colors hover:bg-foreground/[0.06]">
                          <Plus className="size-3" aria-hidden />{w}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="grid gap-1.5 text-xs">
                    <span className="text-muted-foreground">Skip posts that contain (optional)</span>
                    <Input
                      value={words.skip}
                      placeholder="e.g. ABC News, television"
                      onChange={(e) => {
                        setTyped((t) => ({ ...t, [a.term]: { context: t[a.term]?.context ?? words.context, skip: e.target.value } }));
                        update(i, { negativeTerms: parseTerms(e.target.value) });
                      }}
                    />
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {onlyBrand ? (
        <p className="rounded-2xl border border-dashed p-4 text-[13px] text-muted-foreground">
          Your {allowance!.planName} plan includes {allowance!.max === 1 ? "one keyword" : `${allowance!.max} keywords`}, and your product name
          uses it. To listen for more names, handles or misspellings,{" "}
          <a href="/settings/billing" className="font-medium text-foreground underline underline-offset-2">see the plans</a>.
        </p>
      ) : (
      <div className="grid gap-1.5">
        <div className="flex gap-2">
          <label htmlFor={addId} className="sr-only">Add a keyword</label>
          <Input
            id={addId}
            value={draft}
            maxLength={100}
            placeholder="Another name, handle or misspelling"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={add}>
            <Plus /> Add
          </Button>
        </div>
      </div>
      )}

      {overLimit && allowance && (
        <p className="text-xs text-negative" role="alert">
          {enabledCount} keywords are on, but your {allowance.planName} plan allows {allowance.available} for this product. Switch some off to save.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground/[0.06] pt-4">
        <div className="flex items-center gap-3">
          {allowance && allowance.available > 0 && (
            <span className="flex gap-1" aria-hidden>
              {Array.from({ length: Math.min(allowance.available, 10) }, (_, k) => (
                <span key={k} className={cn("h-1.5 w-5 rounded-full", k < enabledCount ? "bg-foreground" : "bg-foreground/[0.12]")} />
              ))}
            </span>
          )}
          <p className="text-xs text-muted-foreground tabular">
            {enabledCount} of {onlyBrand ? aliases.filter((x) => isBrandTerm(x.term, productName!)).length : aliases.length} keywords on
            {allowance && ` · plan allows ${allowance.available}${allowance.available !== allowance.max ? ` here (${allowance.max} per workspace)` : ""}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {blocked && <span className="text-xs text-warning" role="status">{blocked}</span>}
          <SubmitButton disabled={enabledCount === 0 || overLimit} pendingLabel="Saving…">
            {mode === "onboarding" ? "Save and continue" : "Save keywords"}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
