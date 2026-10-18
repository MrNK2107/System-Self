// The app-side game types. Shapes kept from the old local AppContext so screens keep working; values now
// come from the server (see mappers.ts). No React Native imports.
import type { RankedDomain, Rank as ContractRank } from "@workspace/contracts";
import type { AchievementId } from "@workspace/engine";

export type { AchievementId };

export type Domain = RankedDomain;
export type Rank = ContractRank;
export type QuestType = "daily" | "weekly" | "arc";
export type QuestStatus = "active" | "complete" | "failed" | "refused";
export type Trajectory = "up" | "stable" | "down";
export type DebriefVerdict = "ACCEPTABLE" | "INSUFFICIENT" | "PATHETIC";
export type ShadowPhase = "DORMANT" | "AWAKENED" | "HUNTING" | "DOMINANT";
export type ChallengeOutcome = "win" | "loss" | "draw";
export type MilestoneTier = 60 | 70 | 80 | 90 | 100;

export interface User {
  id: string;
  username: string;
  codename: string;
  identitySetting: "anonymous" | "semi-public" | "public";
  rank: Rank;
  primaryGoal: string;
  biggestWeakness: Domain;
  morningTime: string;
  nightlyTime: string;
  onboardingComplete: true;
  createdAt: string;
  dayNumber: number;
}

export interface DomainScore {
  domain: Domain;
  score: number;
  streak: number;
  lastLog: string | null;
}

export interface LogEntry {
  id: string;
  clientId: string;
  domain: Domain;
  type: string;
  forbidden?: boolean;
  data: Record<string, unknown>;
  timestamp: string;
  /** Queued in the outbox, not yet accepted by the server. */
  pending: boolean;
}

export interface Quest {
  id: string;
  type: QuestType;
  title: string;
  description: string;
  domain: Domain;
  status: QuestStatus;
  expiresAt: string;
  generatedBySystem: boolean;
  chainId?: string;
  chainStep?: number;
  chainTotal?: number;
  isRankUpPrep?: boolean;
}

export interface QuestChain {
  /** The template key: a user has at most one active chain per template. */
  id: string;
  templateKey: string;
  name: string;
  description: string;
  domain: Domain;
  steps: { title: string; description: string; reward: string }[];
  currentStep: number;
  /** Server step count of the template. */
  totalSteps: number;
  status: "active" | "complete" | "abandoned";
}

/** A chain the server offers, started or not. */
export type ChainTemplate = Omit<QuestChain, "id" | "currentStep" | "totalSteps" | "status">;

export interface Achievement {
  id: AchievementId;
  unlockedAt: string | null;
}

export interface PendingAchievement {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export interface DomainMilestone {
  domain: Domain;
  tier: MilestoneTier;
  title: string;
  unlockedAt: string | null;
}

export interface PendingMilestone {
  domain: Domain;
  tier: MilestoneTier;
  title: string;
}

export interface ShadowSelf {
  active: boolean;
  codename: string;
  gap: number;
  phase: ShadowPhase;
  rank: Rank;
  scores: Record<Domain, number>;
  /** Display only: points per day the shadow gains in each domain. */
  dailyGainRate: Record<Domain, number>;
}

export interface PendingRankUp {
  fromRank: Rank;
  toRank: Rank;
  newCodename: string;
}

export interface DebriefData {
  date: string;
  domainDeltas: Record<Domain, number>;
  questCompleted: number;
  questTotal: number;
  shadowGap: number;
  aiText: string;
  verdict: DebriefVerdict;
}

export interface StreakBreakData {
  detectedAt: string;
  brokenDomains: { domain: Domain; lostStreak: number }[];
  penalty: number;
  aiText: string;
}

// --- rivals (local until P5) --------------------------------------------------

/** Rivals rate only the four original domains; they are simulated locally until P5. */
export type RivalDomain = "BODY" | "MIND" | "WEALTH" | "DISCIPLINE";

export interface RivalTaunt {
  id: string;
  rivalCodename: string;
  message: string;
  generatedAt: string;
  read: boolean;
}

export interface Rival {
  codename: string;
  rank: Rank;
  bodyScore: number;
  mindScore: number;
  wealthScore: number;
  disciplineScore: number;
  trajectory: Trajectory;
  shadowActive: boolean;
  lastTauntDate?: string | null;
}

export interface Challenge {
  id: string;
  rivalCodename: string;
  rivalRank: Rank;
  domain: RivalDomain;
  startDate: string;
  endDate: string;
  userStartScore: number;
  rivalStartScore: number;
  userCurrentScore: number;
  rivalCurrentScore: number;
  outcome: ChallengeOutcome | null;
  acknowledged: boolean;
}

export interface ChallengeRecord {
  wins: number;
  losses: number;
  draws: number;
}
