import type { RankedDomain } from "./constants";

export const MILESTONE_TIERS = [60, 70, 80, 90, 100] as const;

export const MILESTONE_TITLES: Record<RankedDomain, Record<60 | 70 | 80 | 90 | 100, string>> = {
  BODY: { 60: "CONDITIONED", 70: "HARDENED", 80: "PHYSICAL APEX", 90: "MACHINE", 100: "SOVEREIGN BODY" },
  MIND: { 60: "AWARE", 70: "SHARPENED", 80: "STRATEGIC", 90: "ARCHITECT", 100: "ORACLE MIND" },
  WEALTH: { 60: "BUILDER", 70: "ACCUMULATOR", 80: "ASSET CLASS", 90: "LEVERAGE", 100: "SYSTEM WEALTH" },
  SOCIAL: { 60: "CONNECTED", 70: "MAGNETIC", 80: "INFLUENTIAL", 90: "COMMANDING", 100: "SOCIAL SOVEREIGN" },
  DISCIPLINE: { 60: "STRUCTURED", 70: "RELENTLESS", 80: "IRON WILL", 90: "PROTOCOL", 100: "DISCIPLINE SOVEREIGN" },
};

/** Every tier with prev < tier <= next that is not yet unlocked (keys are `${domain}_${tier}`). */
export function crossedMilestones(
  domain: RankedDomain,
  prev: number,
  next: number,
  unlocked: ReadonlySet<string>,
): number[] {
  return MILESTONE_TIERS.filter((t) => prev < t && t <= next && !unlocked.has(`${domain}_${t}`));
}
