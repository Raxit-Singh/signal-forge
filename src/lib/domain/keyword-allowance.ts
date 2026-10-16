// Keyword allowance helpers shared by the keyword editor (client) and pages (server).

export interface KeywordAllowance {
  planName: string;
  /** Plan's active keywords per workspace. */
  max: number;
  /** Active keywords this product may have (max minus other products' active keywords). */
  available: number;
}

export function overAllowanceReason(allowance: KeywordAllowance): string {
  return `Off: your ${allowance.planName} plan includes ${allowance.max} active keyword${allowance.max === 1 ? "" : "s"}. Turn another off to use this one, or change plan.`;
}

/** Suggestions beyond the allowance start switched off (the user picks which ones stay on). */
export function fitSuggestionsToAllowance<A extends { enabled: boolean; reason?: string }>(list: A[], allowance: KeywordAllowance): A[] {
  let on = 0;
  return list.map((a) => {
    if (!a.enabled) return a;
    if (on < allowance.available) {
      on++;
      return a;
    }
    return { ...a, enabled: false, reason: overAllowanceReason(allowance) };
  });
}
