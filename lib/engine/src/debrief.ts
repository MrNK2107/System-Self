import { RANKED_DOMAINS, type RankedDomain } from "./constants";

export type DebriefVerdict = "ACCEPTABLE" | "INSUFFICIENT" | "PATHETIC";

export function debriefVerdict(deltas: Record<RankedDomain, number>, questRate: number): DebriefVerdict {
  const avg = RANKED_DOMAINS.reduce((s, d) => s + deltas[d], 0) / RANKED_DOMAINS.length;

  if (avg <= 0 && questRate === 0) return "PATHETIC";
  if (avg < -1 && questRate < 0.25) return "PATHETIC";
  if (avg >= 2.0 && deltas.DISCIPLINE >= 0 && questRate >= 0.5) return "ACCEPTABLE";
  return "INSUFFICIENT";
}
