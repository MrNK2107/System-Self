import { RANKED_DOMAINS, type RankedDomain } from "./constants";

export type DebriefVerdict = "ACCEPTABLE" | "INSUFFICIENT" | "PATHETIC";

/**
 * `questRate` is completed / resolved for the day, or null when no quest was resolved: with nothing to fail the day
 * is judged on score movement alone and can't be PATHETIC (a first day judged before any quest came due).
 */
export function debriefVerdict(deltas: Record<RankedDomain, number>, questRate: number | null): DebriefVerdict {
  const avg = RANKED_DOMAINS.reduce((s, d) => s + deltas[d], 0) / RANKED_DOMAINS.length;

  if (questRate === null) return avg >= 2.0 && deltas.DISCIPLINE >= 0 ? "ACCEPTABLE" : "INSUFFICIENT";

  if (avg <= 0 && questRate === 0) return "PATHETIC";
  if (avg < -1 && questRate < 0.25) return "PATHETIC";
  if (avg >= 2.0 && deltas.DISCIPLINE >= 0 && questRate >= 0.5) return "ACCEPTABLE";
  return "INSUFFICIENT";
}
