import type { RankedDomain } from "./constants";

export interface ChainStep {
  title: string;
  description: string;
  reward: string;
}

export interface ChainTemplate {
  templateKey: string;
  name: string;
  description: string;
  domain: RankedDomain;
  steps: ChainStep[];
}

export const CHAIN_TEMPLATES: readonly ChainTemplate[] = [
  {
    templateKey: "physical_protocol",
    name: "PHYSICAL PROTOCOL",
    description: "3-step body conditioning arc. Each step unlocks the next.",
    domain: "BODY",
    steps: [
      { title: "BASELINE ASSESSMENT", description: "Log a complete physical entry covering sleep, exercise, and nutrition in a single day.", reward: "+3 BODY" },
      { title: "CONSECUTIVE CONDITIONING", description: "Log BODY entries for 3 consecutive days without breaking the chain.", reward: "+5 BODY" },
      { title: "THRESHOLD BREACH", description: "Push your BODY score past 65 from its current standing.", reward: "+8 BODY + MILESTONE" },
    ],
  },
  {
    templateKey: "mind_sharpening",
    name: "MIND SHARPENING ARC",
    description: "3-step cognitive development chain.",
    domain: "MIND",
    steps: [
      { title: "DEEP FOCUS SESSION", description: "Log a 90-minute uninterrupted work session today.", reward: "+3 MIND" },
      { title: "KNOWLEDGE INPUT", description: "Log 3 separate learning or reading sessions across 3 days.", reward: "+5 MIND" },
      { title: "COGNITIVE SOVEREIGNTY", description: "Push MIND score past 65.", reward: "+8 MIND + MILESTONE" },
    ],
  },
  {
    templateKey: "wealth_accumulation",
    name: "WEALTH ACCUMULATION CHAIN",
    description: "3-step financial discipline arc.",
    domain: "WEALTH",
    steps: [
      { title: "FINANCIAL AUDIT", description: "Log a complete financial review entry — income, expenses, net position.", reward: "+3 WEALTH" },
      { title: "INCOME ACTION", description: "Log 2 separate wealth-building actions within 5 days.", reward: "+5 WEALTH" },
      { title: "ASSET THRESHOLD", description: "Push WEALTH score past 65.", reward: "+8 WEALTH + MILESTONE" },
    ],
  },
  {
    templateKey: "discipline_forge",
    name: "DISCIPLINE FORGE",
    description: "The hardest chain. 3 steps of iron consistency.",
    domain: "DISCIPLINE",
    steps: [
      { title: "SYSTEM COMMITMENT", description: "Log entries across all 4 domains on the same day.", reward: "+4 DISCIPLINE" },
      { title: "STREAK LOCK", description: "Maintain a 5-day DISCIPLINE logging streak.", reward: "+6 DISCIPLINE" },
      { title: "IRON THRESHOLD", description: "Push DISCIPLINE past 70 — the baseline for hidden score multiplier.", reward: "+10 DISCIPLINE + IRON PROTOCOL" },
    ],
  },
];

export function findChainTemplate(templateKey: string): ChainTemplate | undefined {
  return CHAIN_TEMPLATES.find((t) => t.templateKey === templateKey);
}

/** The quest definition for one step of a chain template. Throws on an unknown template or step. */
export function chainStepQuest(
  templateKey: string,
  step: number,
): { title: string; description: string; domain: RankedDomain; type: "arc" } {
  const t = findChainTemplate(templateKey);
  const s = t?.steps[step];
  if (!t || !s) throw new Error(`Unknown chain step: ${templateKey}#${step}`);
  return {
    title: `[${t.name}] ${s.title}`,
    description: `${s.description}\n\nReward: ${s.reward}`,
    domain: t.domain,
    type: "arc",
  };
}
