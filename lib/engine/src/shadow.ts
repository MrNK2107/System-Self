import { RANKED_DOMAINS, type Rank, type RankedDomain } from "./constants";
import { tierOf, type Snapshot } from "./rank";

export interface ShadowState {
  active: boolean;
  codename: string;
  initialScores: Record<RankedDomain, number>;
  gainRates: Record<RankedDomain, number>;
  /** ISO timestamp, null while dormant. */
  activatedAt: string | null;
}

export type ShadowPhase = "DORMANT" | "AWAKENED" | "HUNTING" | "DOMINANT";

export const SHADOW_GAIN_RATES: Record<RankedDomain, number> = {
  BODY: 1.4,
  MIND: 1.2,
  WEALTH: 1.0,
  SOCIAL: 1.0,
  DISCIPLINE: 1.8,
};
export const SHADOW_HEAD_START = 12;

const MS_PER_DAY = 86_400_000;
const INACTIVE_DAYS_TRIGGER = 5;
const MIN_SNAPSHOTS = 14;
const BELOW_MEAN_RUN = 7;
const TRAILING_WINDOW = 30;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const meanOf = (scores: Record<RankedDomain, number>) => mean(RANKED_DOMAINS.map((d) => scores[d]));

export function initShadow(scores: Record<RankedDomain, number>, username: string, now: Date): ShadowState {
  const initialScores = {} as Record<RankedDomain, number>;
  for (const d of RANKED_DOMAINS) initialScores[d] = Math.min(100, scores[d] + SHADOW_HEAD_START);
  return {
    active: true,
    codename: `SHADOW // ${username.toUpperCase()}`,
    initialScores,
    gainRates: { ...SHADOW_GAIN_RATES },
    activatedAt: now.toISOString(),
  };
}

function daysElapsed(s: ShadowState, now: Date): number {
  if (!s.active || !s.activatedAt) return 0;
  return Math.max(0, (now.getTime() - new Date(s.activatedAt).getTime()) / MS_PER_DAY);
}

export function shadowScores(s: ShadowState, now: Date): Record<RankedDomain, number> {
  if (!s.active || !s.activatedAt) return { ...s.initialScores };
  const days = daysElapsed(s, now);
  const out = {} as Record<RankedDomain, number>;
  for (const d of RANKED_DOMAINS) out[d] = Math.min(100, s.initialScores[d] + days * s.gainRates[d]);
  return out;
}

export function shadowGap(s: ShadowState, userScores: Record<RankedDomain, number>, now: Date): number {
  return meanOf(shadowScores(s, now)) - meanOf(userScores);
}

export function shadowPhase(s: ShadowState, gap: number, now: Date): ShadowPhase {
  if (!s.active || !s.activatedAt) return "DORMANT";
  const days = daysElapsed(s, now);
  if (days < 3 && gap < 5) return "AWAKENED";
  if (days < 14 && gap < 20) return "HUNTING";
  return "DOMINANT";
}

export function shadowRank(s: ShadowState, now: Date): Rank {
  return tierOf(meanOf(shadowScores(s, now)));
}

export function shouldActivateShadow(snapshots: Snapshot[], inactiveDays: number): boolean {
  if (inactiveDays >= INACTIVE_DAYS_TRIGGER) return true;
  if (snapshots.length < MIN_SNAPSHOTS) return false;
  for (let i = snapshots.length - BELOW_MEAN_RUN; i < snapshots.length; i++) {
    const preceding = snapshots.slice(Math.max(0, i - TRAILING_WINDOW), i);
    if (preceding.length === 0) return false;
    if (!(snapshots[i]!.hidden < mean(preceding.map((p) => p.hidden)))) return false;
  }
  return true;
}

export function isShadowResolved(s: ShadowState, userScores: Record<RankedDomain, number>, now: Date): boolean {
  if (!s.active) return false;
  const sh = shadowScores(s, now);
  return RANKED_DOMAINS.every((d) => userScores[d] >= sh[d]);
}
