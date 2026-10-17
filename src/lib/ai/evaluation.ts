// Shadow-mode relevance evaluation (pure).
//
// AI relevance is a recommendation only: relevance_status (rules + people) stays
// authoritative and drives the mention allowance. To decide whether AI relevance
// may ever influence billing, compare it with what people decided. Positive class
// = "about the product". Manual labels are the ground truth; rule labels are not.

export type ManualLabel = "user_relevant" | "user_irrelevant";
export type AiLabel = "yes" | "no" | "unsure";

export interface EvalRow {
  manual: ManualLabel;
  ai: AiLabel;
}

export interface RelevanceEvaluation {
  /** Manually labelled mentions that also have an AI answer. */
  compared: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  /** AI answered "unsure" (excluded from precision/recall). */
  uncertain: number;
  precision: number | null;
  recall: number | null;
  /** Wilson 95% lower bounds: what can be claimed with this many examples. */
  precisionLower: number | null;
  recallLower: number | null;
  /** Below this many decided comparisons the numbers aren't meaningful. */
  sufficient: boolean;
}

export const MIN_COMPARISONS = 100;

function wilsonLower(successes: number, n: number, z = 1.96): number | null {
  if (n === 0) return null;
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (c - m) / d);
}

export function evaluateRelevance(rows: EvalRow[]): RelevanceEvaluation {
  let tp = 0, fp = 0, tn = 0, fn = 0, unsure = 0;
  for (const r of rows) {
    if (r.ai === "unsure") { unsure++; continue; }
    const truth = r.manual === "user_relevant";
    const pred = r.ai === "yes";
    if (pred && truth) tp++;
    else if (pred && !truth) fp++;
    else if (!pred && !truth) tn++;
    else fn++;
  }
  const decided = tp + fp + tn + fn;
  const round = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);
  return {
    compared: rows.length,
    truePositives: tp, falsePositives: fp, trueNegatives: tn, falseNegatives: fn, uncertain: unsure,
    precision: round(tp + fp ? tp / (tp + fp) : null),
    recall: round(tp + fn ? tp / (tp + fn) : null),
    precisionLower: round(wilsonLower(tp, tp + fp)),
    recallLower: round(wilsonLower(tp, tp + fn)),
    sufficient: decided >= MIN_COMPARISONS,
  };
}
