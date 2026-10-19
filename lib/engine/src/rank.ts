import { RANKED_DOMAINS, RANKS, type Rank, type RankedDomain } from "./constants";
import { addDays } from "./dates";

export interface Snapshot {
  date: string;
  hidden: number;
}

const WEIGHTS: Record<RankedDomain, number> = {
  BODY: 0.2,
  MIND: 0.2,
  WEALTH: 0.15,
  SOCIAL: 0.15,
  DISCIPLINE: 0.3,
};

const FLOORS: Record<Rank, number> = { E: 0, D: 26, C: 41, B: 56, A: 71, S: 86 };
const CEILS: Record<Rank, number> = { E: 25, D: 40, C: 55, B: 70, A: 85, S: 100 };

const PROMOTION_WINDOW = 14;
const DEMOTION_WINDOW = 7;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function completionMultiplier(resolved: number, completed: number): number {
  if (resolved < 5) return 1.0;
  const rate = completed / resolved;
  if (rate >= 0.9) return 1.1;
  if (rate < 0.5) return 0.85;
  return 1.0;
}

export function hiddenScore(scores: Record<RankedDomain, number>, multiplier: number): number {
  let sum = 0;
  for (const d of RANKED_DOMAINS) sum += scores[d] * WEIGHTS[d];
  return round2(sum * multiplier);
}

export function tierOf(hidden: number): Rank {
  if (hidden >= 86) return "S";
  if (hidden >= 71) return "A";
  if (hidden >= 56) return "B";
  if (hidden >= 41) return "C";
  if (hidden >= 26) return "D";
  return "E";
}

export const rankFloor = (rank: Rank): number => FLOORS[rank];
export const rankCeil = (rank: Rank): number => CEILS[rank];

export function tierProgress(hidden: number, rank: Rank): number {
  const floor = FLOORS[rank];
  const ceil = CEILS[rank];
  const pct = ((hidden - floor) / (ceil - floor)) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)));
}

const rankIndex = (rank: Rank) => RANKS.indexOf(rank);

/** `snapshots` are the days that count: the caller drops Rank Freeze days, so both windows pause during a freeze. */
export function evaluateRankTransition(
  rank: Rank,
  snapshots: Snapshot[],
  freezeActive: boolean,
): { kind: "promotion" | "demotion"; to: Rank } | null {
  const idx = rankIndex(rank);

  if (idx < RANKS.length - 1 && snapshots.length >= PROMOTION_WINDOW) {
    const last = snapshots.slice(-PROMOTION_WINDOW);
    if (last.every((s) => rankIndex(tierOf(s.hidden)) > idx)) {
      return { kind: "promotion", to: RANKS[idx + 1]! };
    }
  }

  if (idx > 0 && !freezeActive && snapshots.length >= DEMOTION_WINDOW) {
    const last = snapshots.slice(-DEMOTION_WINDOW);
    if (last.every((s) => s.hidden < FLOORS[rank])) {
      return { kind: "demotion", to: RANKS[idx - 1]! };
    }
  }

  return null;
}

export function trajectory(snapshots: Snapshot[], currentHidden: number): "up" | "stable" | "down" {
  const newest = snapshots[snapshots.length - 1];
  if (!newest) return "stable";
  const target = addDays(newest.date, -7);
  const reference = snapshots.find((s) => s.date === target) ?? snapshots[0]!;
  const diff = round2(currentHidden - reference.hidden);
  if (diff > 1.0) return "up";
  if (diff < -1.0) return "down";
  return "stable";
}

const CODENAME_PREFIX: Record<Rank, string> = {
  E: "GHOST",
  D: "VECTOR",
  C: "CIPHER",
  B: "PHANTOM",
  A: "WRAITH",
  S: "ORACLE",
};
const CODENAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateCodename(rank: Rank, rng: () => number = Math.random): string {
  const pick = (n: number) => Math.min(n - 1, Math.floor(rng() * n));
  let code = "";
  for (let i = 0; i < 3; i++) code += CODENAME_CHARS[pick(CODENAME_CHARS.length)];
  return `${CODENAME_PREFIX[rank]} // ${code}-${pick(9) + 1}`;
}
