// When the keyword rules can't decide a mention ("needs review"), a confident
// AI answer decides it. Pure; unit-tested.
//
// Only "pending" mentions are ever changed: rule decisions stay, and a team
// member's own Relevant / Not relevant (user_relevant / user_irrelevant) always
// wins and is never overwritten. "Unsure" or low-confidence answers wait for a
// person.

export const AI_DECISION_MIN_CONFIDENCE = 0.7;

export function aiRelevanceDecision(
  status: string,
  aboutProduct: string | null | undefined,
  confidence: number | null | undefined,
): "relevant" | "irrelevant" | null {
  if (status !== "pending") return null;
  if (typeof confidence !== "number" || !(confidence >= AI_DECISION_MIN_CONFIDENCE)) return null;
  if (aboutProduct === "yes") return "relevant";
  if (aboutProduct === "no") return "irrelevant";
  return null;
}
