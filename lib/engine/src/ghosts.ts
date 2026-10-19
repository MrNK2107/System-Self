/**
 * Ghost rivals: server-simulated rival profiles that fill rival slots when no real player matches (cold start).
 * They drift once per local date like the old client simulation, but seeded by (ghost id, date) so a drift is
 * deterministic and can be replayed. Ghosts are never shown as real people.
 */
import { RANKED_DOMAINS, type Rank, type RankedDomain } from "./constants";
import { rankCeil, rankFloor } from "./rank";

export type GhostTrajectory = "up" | "stable" | "down";

export interface GhostProfile {
  rank: Rank;
  scores: Record<RankedDomain, number>;
  trajectory: GhostTrajectory;
  shadowActive: boolean;
}

export interface GhostState extends GhostProfile {
  id: string;
}

/** makeGhost places every domain score within this many points of the owner's rank band midpoint. */
export const GHOST_SCORE_SPREAD = 6;
const GHOST_SHADOW_CHANCE = 0.3;

const clampScore = (v: number) => Math.min(99, Math.max(1, v));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** FNV-1a 32-bit hash of a string. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A deterministic PRNG (mulberry32) seeded from a string; values in [0, 1). */
export function seededRng(seed: string): () => number {
  let a = hash32(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Midpoint of a rank's hidden-score band (E 0-25 -> 12.5, D 26-40 -> 33, ...). */
export const rankBandMidpoint = (rank: Rank): number => (rankFloor(rank) + rankCeil(rank)) / 2;

/**
 * One day of drift for `date` (the old client's rule): base drift up `0.35 + r*0.45`, down `-(0.25 + r*0.35)`,
 * stable `(r - 0.5)*0.18`; each domain moves `base*(0.4 + r*0.6)`, clamped to 1..99. The RNG is seeded by
 * `${ghost.id}:${date}`: the first draw is the base, then one per domain in RANKED_DOMAINS order.
 */
export function ghostDrift(ghost: GhostState, date: string): GhostState {
  const r = seededRng(`${ghost.id}:${date}`);
  const r0 = r();
  const base =
    ghost.trajectory === "up" ? 0.35 + r0 * 0.45 : ghost.trajectory === "down" ? -(0.25 + r0 * 0.35) : (r0 - 0.5) * 0.18;
  const scores = {} as Record<RankedDomain, number>;
  for (const d of RANKED_DOMAINS) scores[d] = round2(clampScore(ghost.scores[d] + base * (0.4 + r() * 0.6)));
  return { ...ghost, scores };
}

/** A fresh ghost for an owner of `ownerRank`: scores around the band midpoint +-6, random trajectory and shadow. */
export function makeGhost(ownerRank: Rank, rng: () => number = Math.random): GhostProfile {
  const mid = rankBandMidpoint(ownerRank);
  const scores = {} as Record<RankedDomain, number>;
  for (const d of RANKED_DOMAINS) {
    const v = mid + (rng() * 2 - 1) * GHOST_SCORE_SPREAD;
    scores[d] = round2(clampScore(Math.min(mid + GHOST_SCORE_SPREAD, Math.max(mid - GHOST_SCORE_SPREAD, v))));
  }
  const t = rng();
  const trajectory: GhostTrajectory = t < 1 / 3 ? "up" : t < 2 / 3 ? "stable" : "down";
  return { rank: ownerRank, scores, trajectory, shadowActive: rng() < GHOST_SHADOW_CHANCE };
}
