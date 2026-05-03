import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Domain = "BODY" | "MIND" | "WEALTH" | "DISCIPLINE";
export type Rank = "E" | "D" | "C" | "B" | "A" | "S";
export type QuestType = "daily" | "weekly" | "arc";
export type QuestStatus = "active" | "complete" | "failed" | "refused";
export type Trajectory = "up" | "stable" | "down";
export type DebriefVerdict = "ACCEPTABLE" | "INSUFFICIENT" | "PATHETIC";
export type ShadowPhase = "DORMANT" | "AWAKENED" | "HUNTING" | "DOMINANT";
export type ChallengeOutcome = "win" | "loss" | "draw";

export type AchievementId =
  | "first_log" | "streak_7" | "streak_30" | "beat_shadow"
  | "rank_d" | "rank_c" | "rank_b" | "rank_a" | "rank_s"
  | "quest_10" | "quest_50" | "forbidden_log" | "challenge_win"
  | "challenge_5" | "domain_80" | "domain_100"
  | "all_domains_60" | "discipline_master" | "seven_days_straight";

export interface User {
  id: string;
  username: string;
  identitySetting: "anonymous" | "semi-public" | "public";
  rank: Rank;
  primaryGoal: string;
  biggestWeakness: Domain;
  morningTime: string;
  nightlyTime: string;
  onboardingComplete: boolean;
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
  domain: Domain;
  type: string;
  forbidden?: boolean;
  data: Record<string, unknown>;
  timestamp: string;
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
  id: string;
  name: string;
  description: string;
  domain: Domain;
  steps: { title: string; description: string; reward: string }[];
  currentStep: number;
  status: "active" | "complete" | "abandoned";
  startedAt: string;
}

export interface Achievement {
  id: AchievementId;
  unlockedAt: string | null;
}

export interface PendingAchievement {
  id: AchievementId;
  title: string;
  description: string;
  icon: string;
}

export type MilestoneTier = 60 | 70 | 80 | 90 | 100;

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

export interface ShadowSelf {
  active: boolean;
  codename: string;
  initialScores: Record<Domain, number>;
  dailyGainRate: Record<Domain, number>;
  activatedAt: string | null;
  gap: number;
  phase?: ShadowPhase;
}

export interface PendingRankUp {
  fromRank: Rank;
  toRank: Rank;
  newCodename: string;
}

export interface DailyBaseline {
  date: string;
  scores: Record<Domain, number>;
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

export interface Challenge {
  id: string;
  rivalCodename: string;
  rivalRank: Rank;
  domain: Domain;
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

// --- achievement definitions ------------------------------------------------

export const ACHIEVEMENT_DEFS: Record<AchievementId, { title: string; description: string; icon: string }> = {
  first_log: { title: "FIRST TRANSMISSION", description: "Log your first entry into the system", icon: "zap" },
  streak_7: { title: "7-DAY OPERATIVE", description: "Maintain a 7-day logging streak in any domain", icon: "calendar" },
  streak_30: { title: "MONTH PROTOCOL", description: "Maintain a 30-day logging streak", icon: "award" },
  beat_shadow: { title: "SHADOW SLAYER", description: "Surpass your Shadow Self in all domains", icon: "eye-off" },
  rank_d: { title: "VECTOR CONFIRMED", description: "Reached rank D — awareness acknowledged", icon: "trending-up" },
  rank_c: { title: "CIPHER UNLOCKED", description: "Reached rank C — consistency established", icon: "trending-up" },
  rank_b: { title: "PHANTOM PROTOCOL", description: "Reached rank B — discipline demonstrated", icon: "trending-up" },
  rank_a: { title: "WRAITH TIER", description: "Reached rank A — elite class entry", icon: "trending-up" },
  rank_s: { title: "ORACLE ASCENSION", description: "Reached the apex rank S", icon: "star" },
  quest_10: { title: "FIELD OPERATOR", description: "Complete 10 quests total", icon: "target" },
  quest_50: { title: "SYSTEM OPERATIVE", description: "Complete 50 quests — career operand", icon: "flag" },
  forbidden_log: { title: "CORRUPTED SIGNAL", description: "Transmit a forbidden entry", icon: "alert-triangle" },
  challenge_win: { title: "FIRST BLOOD", description: "Win your first 7-day challenge", icon: "zap" },
  challenge_5: { title: "SERIAL CHALLENGER", description: "Win 5 challenges total", icon: "users" },
  domain_80: { title: "MASTERY INITIATED", description: "Push any domain to 80+", icon: "bar-chart-2" },
  domain_100: { title: "DOMAIN SOVEREIGN", description: "Max out any domain at 100", icon: "maximize" },
  all_domains_60: { title: "BALANCED ENTITY", description: "All 4 domains above 60 simultaneously", icon: "grid" },
  discipline_master: { title: "IRON PROTOCOL", description: "Reach 90+ in DISCIPLINE", icon: "shield" },
  seven_days_straight: { title: "NO GAPS", description: "Log all 4 domains for 7 consecutive days", icon: "lock" },
};

// --- milestone definitions --------------------------------------------------

export const MILESTONE_TITLES: Record<Domain, Record<MilestoneTier, string>> = {
  BODY: { 60: "CONDITIONED", 70: "HARDENED", 80: "PHYSICAL APEX", 90: "MACHINE", 100: "SOVEREIGN BODY" },
  MIND: { 60: "AWARE", 70: "SHARPENED", 80: "STRATEGIC", 90: "ARCHITECT", 100: "ORACLE MIND" },
  WEALTH: { 60: "BUILDER", 70: "ACCUMULATOR", 80: "ASSET CLASS", 90: "LEVERAGE", 100: "SYSTEM WEALTH" },
  DISCIPLINE: { 60: "STRUCTURED", 70: "RELENTLESS", 80: "IRON WILL", 90: "PROTOCOL", 100: "DISCIPLINE SOVEREIGN" },
};

// --- helpers ----------------------------------------------------------------

export function getStreakMultiplier(streak: number): number {
  return Math.min(2.0, 1.0 + streak * 0.1);
}

export function getStreakTier(streak: number): "none" | "low" | "mid" | "high" | "max" {
  if (streak === 0) return "none";
  if (streak <= 2) return "low";
  if (streak <= 6) return "mid";
  if (streak <= 9) return "high";
  return "max";
}

export function computeShadowPhase(shadowSelf: ShadowSelf): ShadowPhase {
  if (!shadowSelf.active || !shadowSelf.activatedAt) return "DORMANT";
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysElapsed = (Date.now() - new Date(shadowSelf.activatedAt).getTime()) / msPerDay;
  const gap = shadowSelf.gap;
  if (daysElapsed < 3 && gap < 5) return "AWAKENED";
  if (daysElapsed < 14 && gap < 20) return "HUNTING";
  return "DOMINANT";
}

const RANK_ORDER: Record<Rank, number> = { E: 0, D: 1, C: 2, B: 3, A: 4, S: 5 };
const CODENAME_PREFIXES: Record<Rank, string> = {
  E: "GHOST", D: "VECTOR", C: "CIPHER", B: "PHANTOM", A: "WRAITH", S: "ORACLE",
};

function generateCodename(rank: Rank): string {
  const id = Math.random().toString(36).substr(2, 3).toUpperCase();
  const num = Math.floor(Math.random() * 9) + 1;
  return `${CODENAME_PREFIXES[rank]} // ${id}-${num}`;
}

// --- predefined quest chains ------------------------------------------------

export const PREDEFINED_CHAINS: Omit<QuestChain, "id" | "startedAt" | "currentStep" | "status">[] = [
  {
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

// --- types ------------------------------------------------------------------

interface AppState {
  user: User | null;
  domainScores: DomainScore[];
  logs: LogEntry[];
  quests: Quest[];
  questChains: QuestChain[];
  rivals: Rival[];
  shadowSelf: ShadowSelf;
  trajectory: Trajectory;
  loading: boolean;
  pendingRankUp: PendingRankUp | null;
  dailyBaseline: DailyBaseline | null;
  pendingDebrief: DebriefData | null;
  pendingStreakBreak: StreakBreakData | null;
  challenges: Challenge[];
  challengeRecord: ChallengeRecord;
  achievements: Achievement[];
  milestones: DomainMilestone[];
  rivalTaunts: RivalTaunt[];
  pendingAchievement: PendingAchievement | null;
  pendingMilestone: PendingMilestone | null;
}

interface AppContextType extends AppState {
  setUser: (user: User) => Promise<void>;
  updateDomainScore: (domain: Domain, delta: number, applyStreakBonus?: boolean) => Promise<void>;
  addLog: (entry: Omit<LogEntry, "id" | "timestamp">) => Promise<void>;
  setQuests: (quests: Quest[]) => Promise<void>;
  completeQuest: (questId: string) => Promise<void>;
  refuseQuest: (questId: string) => Promise<void>;
  getDomainScore: (domain: Domain) => number;
  getWeakestDomain: () => Domain;
  getHiddenScore: () => number;
  computeRank: (hiddenScore: number) => Rank;
  getShadowScores: () => Record<Domain, number>;
  getShadowRank: () => Rank;
  updateRivals: (rivals: Rival[]) => Promise<void>;
  declareChallenge: (rivalCodename: string, rivalRank: Rank, domain: Domain) => Promise<void>;
  updateChallengeScores: (challenges: Challenge[]) => Promise<void>;
  acknowledgeChallenge: (challengeId: string) => Promise<void>;
  resolveExpiredChallenges: () => void;
  initializeShadowSelf: (userScores: Record<Domain, number>, username: string) => Promise<void>;
  acknowledgeRankUp: () => Promise<void>;
  setPendingDebrief: (debrief: DebriefData) => Promise<void>;
  acknowledgeDebrief: () => Promise<void>;
  acknowledgeStreakBreak: () => Promise<void>;
  // New actions
  startQuestChain: (chainTemplate: Omit<QuestChain, "id" | "startedAt" | "currentStep" | "status">) => Promise<void>;
  advanceQuestChain: (chainId: string) => Promise<void>;
  addRivalTaunt: (taunt: Omit<RivalTaunt, "id" | "generatedAt" | "read">) => Promise<void>;
  markRivalTauntsRead: () => Promise<void>;
  acknowledgePendingAchievement: () => void;
  acknowledgePendingMilestone: () => void;
  getShadowPhase: () => ShadowPhase;
  getWeeklyRecapData: () => WeeklyRecapData;
  resetAll: () => Promise<void>;
}

export interface WeeklyRecapData {
  weekStart: string;
  domainDeltas: Record<Domain, number>;
  questsCompleted: number;
  challengeWins: number;
  challengeLosses: number;
  logsCount: number;
  peakDomain: Domain;
  forbiddenLogs: number;
  chainsCompleted: number;
  achievementsUnlocked: number;
}

// --- storage ----------------------------------------------------------------

const STORAGE_KEYS = {
  USER: "@system_self:user",
  SCORES: "@system_self:scores",
  LOGS: "@system_self:logs",
  QUESTS: "@system_self:quests",
  QUEST_CHAINS: "@system_self:quest_chains",
  RIVALS: "@system_self:rivals",
  SHADOW: "@system_self:shadow",
  RANK_UP: "@system_self:rank_up",
  BASELINE: "@system_self:baseline",
  DEBRIEF: "@system_self:debrief",
  LAST_DEBRIEF: "@system_self:last_debrief",
  STREAK_BREAK: "@system_self:streak_break",
  CHALLENGES: "@system_self:challenges",
  CHALLENGE_RECORD: "@system_self:challenge_record",
  ACHIEVEMENTS: "@system_self:achievements",
  MILESTONES: "@system_self:milestones",
  RIVAL_TAUNTS: "@system_self:rival_taunts",
};

export { STORAGE_KEYS };

// --- constants --------------------------------------------------------------

const DOMAINS: Domain[] = ["BODY", "MIND", "WEALTH", "DISCIPLINE"];
const MILESTONE_TIERS: MilestoneTier[] = [60, 70, 80, 90, 100];

const BASE_SCORE_DELTAS: Record<Domain, number> = {
  BODY: 2.5, MIND: 2.5, WEALTH: 2.0, DISCIPLINE: 3.0,
};

const DEFAULT_SCORES: DomainScore[] = DOMAINS.map(d => ({
  domain: d, score: 50, streak: 0, lastLog: null,
}));

const DEFAULT_RIVALS: Rival[] = [
  {
    codename: "RIVAL // ECHO-7", rank: "D",
    bodyScore: 52.3, mindScore: 48.1, wealthScore: 55.0, disciplineScore: 49.5,
    trajectory: "up", shadowActive: false, lastTauntDate: null,
  },
  {
    codename: "RIVAL // PHANTOM-3", rank: "D",
    bodyScore: 47.8, mindScore: 53.2, wealthScore: 44.5, disciplineScore: 51.0,
    trajectory: "stable", shadowActive: true, lastTauntDate: null,
  },
];

const DEFAULT_SHADOW: ShadowSelf = {
  active: false, codename: "SHADOW // SELF",
  initialScores: { BODY: 60, MIND: 60, WEALTH: 60, DISCIPLINE: 60 },
  dailyGainRate: { BODY: 1.5, MIND: 1.2, WEALTH: 1.0, DISCIPLINE: 1.8 },
  activatedAt: null, gap: 0,
};

async function postQuestCompletionEvent(params: {
  username: string;
  questId: string;
  status: "complete" | "failed" | "refused";
  domain: Domain;
  questType: QuestType;
}) {
  try {
    const baseUrl = process.env.EXPO_PUBLIC_DOMAIN
      ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
      : "";
    const token = process.env.EXPO_PUBLIC_API_TOKEN;
    await fetch(`${baseUrl}/api/system/quest-completion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        ...params,
        completedAt: new Date().toISOString(),
        source: "app",
      }),
    });
  } catch {
    // Non-blocking: app behavior should not fail when analytics/completion ingestion fails.
  }
}

function initAchievements(): Achievement[] {
  return (Object.keys(ACHIEVEMENT_DEFS) as AchievementId[]).map(id => ({ id, unlockedAt: null }));
}

function initMilestones(): DomainMilestone[] {
  const milestones: DomainMilestone[] = [];
  for (const domain of DOMAINS) {
    for (const tier of MILESTONE_TIERS) {
      milestones.push({ domain, tier, title: MILESTONE_TITLES[domain][tier], unlockedAt: null });
    }
  }
  return milestones;
}

// --- pure helpers -----------------------------------------------------------

function computeRankFromScore(score: number): Rank {
  if (score >= 86) return "S";
  if (score >= 71) return "A";
  if (score >= 56) return "B";
  if (score >= 41) return "C";
  if (score >= 26) return "D";
  return "E";
}

function computeTrajectory(scores: DomainScore[]): Trajectory {
  const avg = scores.reduce((s, d) => s + d.score, 0) / scores.length;
  if (avg > 55) return "up";
  if (avg < 45) return "down";
  return "stable";
}

function computeHiddenScore(scores: DomainScore[]): number {
  const body = scores.find(s => s.domain === "BODY")?.score ?? 50;
  const mind = scores.find(s => s.domain === "MIND")?.score ?? 50;
  const wealth = scores.find(s => s.domain === "WEALTH")?.score ?? 50;
  const discipline = scores.find(s => s.domain === "DISCIPLINE")?.score ?? 50;
  const multiplier = discipline >= 75 ? 1.1 : discipline < 50 ? 0.85 : 1.0;
  return (body * 0.2 + mind * 0.2 + wealth * 0.15 + discipline * 0.45) * multiplier;
}

function computeShadowScores(shadow: ShadowSelf): Record<Domain, number> {
  if (!shadow.active || !shadow.activatedAt) return shadow.initialScores;
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysElapsed = (Date.now() - new Date(shadow.activatedAt).getTime()) / msPerDay;
  return DOMAINS.reduce((acc, d) => {
    acc[d] = Math.min(100, (shadow.initialScores[d] ?? 60) + daysElapsed * (shadow.dailyGainRate[d] ?? 1.5));
    return acc;
  }, {} as Record<Domain, number>);
}

function computeShadowGap(shadow: ShadowSelf, userScores: DomainScore[]): number {
  const shadowScores = computeShadowScores(shadow);
  const shadowAvg = DOMAINS.reduce((s, d) => s + shadowScores[d], 0) / DOMAINS.length;
  const userAvg = userScores.reduce((s, d) => s + d.score, 0) / userScores.length;
  return shadowAvg - userAvg;
}

function makeBaseline(scores: DomainScore[]): DailyBaseline {
  const today = new Date().toISOString().split("T")[0]!;
  return {
    date: today,
    scores: DOMAINS.reduce((acc, d) => {
      acc[d] = scores.find(s => s.domain === d)?.score ?? 50;
      return acc;
    }, {} as Record<Domain, number>),
  };
}

function detectStreakBreaks(scores: DomainScore[]): { domain: Domain; lostStreak: number }[] {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0]!;
  return scores
    .filter(s => s.streak > 0 && s.lastLog !== null && s.lastLog < yesterdayStr)
    .map(s => ({ domain: s.domain, lostStreak: s.streak }));
}

// Check which achievements should be unlocked based on current state
function checkAchievements(
  prev: AppState,
  newScores: DomainScore[],
  newLogs: LogEntry[],
  newQuests: Quest[],
  newChallengeRecord: ChallengeRecord,
  newChallenges: Challenge[],
  newChains: QuestChain[],
): AchievementId[] {
  const unlocked: AchievementId[] = [];
  const alreadyUnlocked = new Set(prev.achievements.filter(a => a.unlockedAt !== null).map(a => a.id));
  const isNew = (id: AchievementId) => !alreadyUnlocked.has(id);

  // first_log
  if (isNew("first_log") && newLogs.length >= 1) unlocked.push("first_log");

  // streak achievements
  const maxStreak = Math.max(...newScores.map(s => s.streak));
  if (isNew("streak_7") && maxStreak >= 7) unlocked.push("streak_7");
  if (isNew("streak_30") && maxStreak >= 30) unlocked.push("streak_30");

  // quest achievements
  const completed = newQuests.filter(q => q.status === "complete").length;
  if (isNew("quest_10") && completed >= 10) unlocked.push("quest_10");
  if (isNew("quest_50") && completed >= 50) unlocked.push("quest_50");

  // forbidden log
  if (isNew("forbidden_log") && newLogs.some(l => l.forbidden)) unlocked.push("forbidden_log");

  // challenge achievements
  if (isNew("challenge_win") && newChallengeRecord.wins >= 1) unlocked.push("challenge_win");
  if (isNew("challenge_5") && newChallengeRecord.wins >= 5) unlocked.push("challenge_5");

  // domain score achievements
  const domScores = newScores.map(s => s.score);
  if (isNew("domain_80") && domScores.some(s => s >= 80)) unlocked.push("domain_80");
  if (isNew("domain_100") && domScores.some(s => s >= 100)) unlocked.push("domain_100");
  if (isNew("all_domains_60") && domScores.every(s => s >= 60)) unlocked.push("all_domains_60");
  const discScore = newScores.find(s => s.domain === "DISCIPLINE")?.score ?? 0;
  if (isNew("discipline_master") && discScore >= 90) unlocked.push("discipline_master");

  // shadow beat
  if (isNew("beat_shadow") && prev.shadowSelf.active) {
    const shadowScores = computeShadowScores(prev.shadowSelf);
    const userBeats = DOMAINS.every(d => (newScores.find(s => s.domain === d)?.score ?? 0) >= shadowScores[d]);
    if (userBeats) unlocked.push("beat_shadow");
  }

  // chain completion
  if (isNew("seven_days_straight")) {
    // check if all domains have 7+ streak
    if (newScores.every(s => s.streak >= 7)) unlocked.push("seven_days_straight");
  }

  return unlocked;
}

function checkMilestonesForScore(
  prev: AppState,
  newScores: DomainScore[],
): PendingMilestone | null {
  for (const domain of DOMAINS) {
    const score = newScores.find(s => s.domain === domain)?.score ?? 0;
    for (const tier of MILESTONE_TIERS) {
      const prevScore = prev.domainScores.find(s => s.domain === domain)?.score ?? 0;
      const alreadyUnlocked = prev.milestones.find(m => m.domain === domain && m.tier === tier)?.unlockedAt !== null;
      if (!alreadyUnlocked && prevScore < tier && score >= tier) {
        return { domain, tier, title: MILESTONE_TITLES[domain][tier] };
      }
    }
  }
  return null;
}

// --- context ----------------------------------------------------------------

const AppContext = createContext<AppContextType | null>(null);

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// --- provider ---------------------------------------------------------------

const DEFAULT_CHALLENGE_RECORD: ChallengeRecord = { wins: 0, losses: 0, draws: 0 };

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>({
    user: null,
    domainScores: DEFAULT_SCORES,
    logs: [],
    quests: [],
    questChains: [],
    rivals: DEFAULT_RIVALS,
    shadowSelf: DEFAULT_SHADOW,
    trajectory: "stable",
    loading: true,
    pendingRankUp: null,
    dailyBaseline: null,
    pendingDebrief: null,
    pendingStreakBreak: null,
    challenges: [],
    challengeRecord: DEFAULT_CHALLENGE_RECORD,
    achievements: initAchievements(),
    milestones: initMilestones(),
    rivalTaunts: [],
    pendingAchievement: null,
    pendingMilestone: null,
  });

  useEffect(() => {
    loadFromStorage();
  }, []);

  const loadFromStorage = async () => {
    try {
      const [
        userStr, scoresStr, logsStr, questsStr, questChainsStr, rivalsStr, shadowStr,
        rankUpStr, baselineStr, debriefStr, streakBreakStr,
        challengesStr, challengeRecordStr,
        achievementsStr, milestonesStr, rivalTauntsStr,
      ] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.USER),
        AsyncStorage.getItem(STORAGE_KEYS.SCORES),
        AsyncStorage.getItem(STORAGE_KEYS.LOGS),
        AsyncStorage.getItem(STORAGE_KEYS.QUESTS),
        AsyncStorage.getItem(STORAGE_KEYS.QUEST_CHAINS),
        AsyncStorage.getItem(STORAGE_KEYS.RIVALS),
        AsyncStorage.getItem(STORAGE_KEYS.SHADOW),
        AsyncStorage.getItem(STORAGE_KEYS.RANK_UP),
        AsyncStorage.getItem(STORAGE_KEYS.BASELINE),
        AsyncStorage.getItem(STORAGE_KEYS.DEBRIEF),
        AsyncStorage.getItem(STORAGE_KEYS.STREAK_BREAK),
        AsyncStorage.getItem(STORAGE_KEYS.CHALLENGES),
        AsyncStorage.getItem(STORAGE_KEYS.CHALLENGE_RECORD),
        AsyncStorage.getItem(STORAGE_KEYS.ACHIEVEMENTS),
        AsyncStorage.getItem(STORAGE_KEYS.MILESTONES),
        AsyncStorage.getItem(STORAGE_KEYS.RIVAL_TAUNTS),
      ]);

      const user = userStr ? JSON.parse(userStr) as User : null;
      let domainScores = scoresStr ? JSON.parse(scoresStr) as DomainScore[] : DEFAULT_SCORES;
      const logs = logsStr ? JSON.parse(logsStr) as LogEntry[] : [];
      const quests = questsStr ? JSON.parse(questsStr) as Quest[] : [];
      const questChains = questChainsStr ? JSON.parse(questChainsStr) as QuestChain[] : [];
      const rivals = rivalsStr ? JSON.parse(rivalsStr) as Rival[] : DEFAULT_RIVALS;
      const shadow = shadowStr ? JSON.parse(shadowStr) as ShadowSelf : DEFAULT_SHADOW;
      const pendingRankUp = rankUpStr ? JSON.parse(rankUpStr) as PendingRankUp : null;
      const pendingDebrief = debriefStr ? JSON.parse(debriefStr) as DebriefData : null;

      // Load achievements + merge with new definitions
      const storedAchievements = achievementsStr ? JSON.parse(achievementsStr) as Achievement[] : [];
      const achievementMap = new Map(storedAchievements.map(a => [a.id, a]));
      const achievements = (Object.keys(ACHIEVEMENT_DEFS) as AchievementId[]).map(id =>
        achievementMap.get(id) ?? { id, unlockedAt: null }
      );

      // Load milestones + merge
      const storedMilestones = milestonesStr ? JSON.parse(milestonesStr) as DomainMilestone[] : [];
      const milestoneMap = new Map(storedMilestones.map(m => [`${m.domain}_${m.tier}`, m]));
      const milestones = initMilestones().map(m =>
        milestoneMap.get(`${m.domain}_${m.tier}`) ?? m
      );

      const rivalTaunts = rivalTauntsStr ? (JSON.parse(rivalTauntsStr) as RivalTaunt[]).slice(-20) : [];

      // Streak break detection
      let pendingStreakBreak: StreakBreakData | null = streakBreakStr
        ? JSON.parse(streakBreakStr) as StreakBreakData
        : null;

      if (!pendingStreakBreak) {
        const broken = detectStreakBreaks(domainScores);
        if (broken.length > 0) {
          const penalty = Math.min(6.0, broken.length * 2.0);
          domainScores = domainScores.map(s => {
            if (broken.find(b => b.domain === s.domain)) return { ...s, streak: 0 };
            if (s.domain === "DISCIPLINE") return { ...s, score: Math.max(0, s.score - penalty) };
            return s;
          });
          await AsyncStorage.setItem(STORAGE_KEYS.SCORES, JSON.stringify(domainScores));
          pendingStreakBreak = { detectedAt: new Date().toISOString(), brokenDomains: broken, penalty, aiText: "" };
          await AsyncStorage.setItem(STORAGE_KEYS.STREAK_BREAK, JSON.stringify(pendingStreakBreak));
        }
      }

      // Daily baseline
      const today = new Date().toISOString().split("T")[0]!;
      let dailyBaseline: DailyBaseline | null = baselineStr ? JSON.parse(baselineStr) as DailyBaseline : null;
      if (!dailyBaseline || dailyBaseline.date !== today) {
        dailyBaseline = makeBaseline(domainScores);
        await AsyncStorage.setItem(STORAGE_KEYS.BASELINE, JSON.stringify(dailyBaseline));
      }

      const gap = shadow.active ? computeShadowGap(shadow, domainScores) : 0;
      const trajectory = computeTrajectory(domainScores);

      // Challenges
      let challenges: Challenge[] = challengesStr ? JSON.parse(challengesStr) as Challenge[] : [];
      let challengeRecord: ChallengeRecord = challengeRecordStr
        ? JSON.parse(challengeRecordStr) as ChallengeRecord
        : DEFAULT_CHALLENGE_RECORD;

      const todayStr = new Date().toISOString().split("T")[0]!;
      let anyResolved = false;
      challenges = challenges.map(c => {
        if (c.outcome !== null || c.endDate >= todayStr) return c;
        const userGain = c.userCurrentScore - c.userStartScore;
        const rivalGain = c.rivalCurrentScore - c.rivalStartScore;
        const outcome: ChallengeOutcome =
          userGain > rivalGain ? "win" : userGain < rivalGain ? "loss" : "draw";
        challengeRecord = {
          wins: challengeRecord.wins + (outcome === "win" ? 1 : 0),
          losses: challengeRecord.losses + (outcome === "loss" ? 1 : 0),
          draws: challengeRecord.draws + (outcome === "draw" ? 1 : 0),
        };
        anyResolved = true;
        return { ...c, outcome };
      });
      if (anyResolved) {
        await AsyncStorage.setItem(STORAGE_KEYS.CHALLENGES, JSON.stringify(challenges));
        await AsyncStorage.setItem(STORAGE_KEYS.CHALLENGE_RECORD, JSON.stringify(challengeRecord));
      }

      setState(prev => ({
        ...prev,
        user,
        domainScores,
        logs,
        quests,
        questChains,
        rivals,
        shadowSelf: { ...shadow, gap },
        trajectory,
        loading: false,
        pendingRankUp,
        dailyBaseline,
        pendingDebrief,
        pendingStreakBreak,
        challenges,
        challengeRecord,
        achievements,
        milestones,
        rivalTaunts,
      }));
    } catch {
      setState(prev => ({ ...prev, loading: false }));
    }
  };

  const setUser = useCallback(async (user: User) => {
    await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    setState(prev => ({ ...prev, user }));
  }, []);

  const updateDomainScore = useCallback(async (
    domain: Domain,
    delta: number,
    applyStreakBonus = true,
  ) => {
    setState(prev => {
      if (!prev.user) return prev;

      const currentStreak = prev.domainScores.find(s => s.domain === domain)?.streak ?? 0;
      const multiplier = applyStreakBonus && delta > 0 ? getStreakMultiplier(currentStreak) : 1.0;
      const actualDelta = Math.round(delta * multiplier * 10) / 10;

      const updated = prev.domainScores.map(s => {
        if (s.domain !== domain) return s;
        const newScore = Math.min(100, Math.max(0, s.score + actualDelta));
        const today = new Date().toISOString().split("T")[0]!;
        const wasToday = s.lastLog === today;
        return { ...s, score: newScore, streak: wasToday ? s.streak : s.streak + 1, lastLog: today };
      });

      const newHiddenScore = computeHiddenScore(updated);
      const newRank = computeRankFromScore(newHiddenScore);
      const currentRank = prev.user.rank;
      const gap = prev.shadowSelf.active ? computeShadowGap(prev.shadowSelf, updated) : 0;
      const trajectory = computeTrajectory(updated);

      let pendingRankUp = prev.pendingRankUp;
      if (RANK_ORDER[newRank] > RANK_ORDER[currentRank] && !prev.pendingRankUp) {
        pendingRankUp = { fromRank: currentRank, toRank: newRank, newCodename: generateCodename(newRank) };
        AsyncStorage.setItem(STORAGE_KEYS.RANK_UP, JSON.stringify(pendingRankUp));
      }

      // Sync active challenge user scores
      const updatedChallenges = prev.challenges.map(c => {
        if (c.domain !== domain || c.outcome !== null) return c;
        const newScore = updated.find(s => s.domain === domain)?.score ?? c.userCurrentScore;
        return { ...c, userCurrentScore: newScore };
      });

      // Check milestones
      const newMilestone = checkMilestonesForScore(prev, updated);
      let milestones = prev.milestones;
      let pendingMilestone = prev.pendingMilestone;
      if (newMilestone && !prev.pendingMilestone) {
        milestones = prev.milestones.map(m =>
          m.domain === newMilestone.domain && m.tier === newMilestone.tier
            ? { ...m, unlockedAt: new Date().toISOString() }
            : m
        );
        pendingMilestone = newMilestone;
        AsyncStorage.setItem(STORAGE_KEYS.MILESTONES, JSON.stringify(milestones));
      }

      // Check achievements
      const newAchIds = checkAchievements(prev, updated, prev.logs, prev.quests, prev.challengeRecord, prev.challenges, prev.questChains);
      let achievements = prev.achievements;
      let pendingAchievement = prev.pendingAchievement;
      if (newAchIds.length > 0 && !prev.pendingAchievement) {
        const firstId = newAchIds[0]!;
        const def = ACHIEVEMENT_DEFS[firstId];
        const now = new Date().toISOString();
        achievements = prev.achievements.map(a =>
          newAchIds.includes(a.id) ? { ...a, unlockedAt: now } : a
        );
        pendingAchievement = { id: firstId, title: def.title, description: def.description, icon: def.icon };
        AsyncStorage.setItem(STORAGE_KEYS.ACHIEVEMENTS, JSON.stringify(achievements));
      }

      AsyncStorage.setItem(STORAGE_KEYS.SCORES, JSON.stringify(updated));
      AsyncStorage.setItem(STORAGE_KEYS.CHALLENGES, JSON.stringify(updatedChallenges));

      return {
        ...prev,
        domainScores: updated,
        challenges: updatedChallenges,
        trajectory,
        shadowSelf: { ...prev.shadowSelf, gap },
        pendingRankUp,
        milestones,
        pendingMilestone,
        achievements,
        pendingAchievement,
      };
    });
  }, []);

  const addLog = useCallback(async (entry: Omit<LogEntry, "id" | "timestamp">) => {
    const newEntry: LogEntry = { ...entry, id: generateId(), timestamp: new Date().toISOString() };
    setState(prev => {
      const updated = [...prev.logs, newEntry];
      if (updated.length > 200) updated.splice(0, updated.length - 200);
      AsyncStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(updated));

      // Achievement check for first log
      const newAchIds = checkAchievements(prev, prev.domainScores, updated, prev.quests, prev.challengeRecord, prev.challenges, prev.questChains);
      let achievements = prev.achievements;
      let pendingAchievement = prev.pendingAchievement;
      if (newAchIds.length > 0 && !prev.pendingAchievement) {
        const firstId = newAchIds[0]!;
        const def = ACHIEVEMENT_DEFS[firstId];
        achievements = prev.achievements.map(a =>
          newAchIds.includes(a.id) ? { ...a, unlockedAt: new Date().toISOString() } : a
        );
        pendingAchievement = { id: firstId, title: def.title, description: def.description, icon: def.icon };
        AsyncStorage.setItem(STORAGE_KEYS.ACHIEVEMENTS, JSON.stringify(achievements));
      }

      return { ...prev, logs: updated, achievements, pendingAchievement };
    });

    // Apply score delta (forbidden logs give +5 but add -2 discipline)
    if (entry.forbidden) {
      await updateDomainScore(entry.domain, 5, false);
      await updateDomainScore("DISCIPLINE", -2, false);
    } else {
      await updateDomainScore(entry.domain, BASE_SCORE_DELTAS[entry.domain], true);
    }
  }, [updateDomainScore]);

  const setQuests = useCallback(async (quests: Quest[]) => {
    await AsyncStorage.setItem(STORAGE_KEYS.QUESTS, JSON.stringify(quests));
    setState(prev => ({ ...prev, quests }));
  }, []);

  const completeQuest = useCallback(async (questId: string) => {
    const questSnapshot = state.quests.find(q => q.id === questId);
    const usernameSnapshot = state.user?.username;
    setState(prev => {
      const quest = prev.quests.find(q => q.id === questId);
      const updated = prev.quests.map(q => q.id === questId ? { ...q, status: "complete" as QuestStatus } : q);
      AsyncStorage.setItem(STORAGE_KEYS.QUESTS, JSON.stringify(updated));

      // Advance quest chain if applicable
      let questChains = prev.questChains;
      if (quest?.chainId) {
        questChains = prev.questChains.map(chain => {
          if (chain.id !== quest.chainId || chain.status !== "active") return chain;
          const nextStep = chain.currentStep + 1;
          if (nextStep >= chain.steps.length) {
            return { ...chain, currentStep: nextStep, status: "complete" };
          }
          return { ...chain, currentStep: nextStep };
        });
        AsyncStorage.setItem(STORAGE_KEYS.QUEST_CHAINS, JSON.stringify(questChains));
      }

      // Achievement check
      const newAchIds = checkAchievements(prev, prev.domainScores, prev.logs, updated, prev.challengeRecord, prev.challenges, questChains);
      let achievements = prev.achievements;
      let pendingAchievement = prev.pendingAchievement;
      if (newAchIds.length > 0 && !prev.pendingAchievement) {
        const firstId = newAchIds[0]!;
        const def = ACHIEVEMENT_DEFS[firstId];
        achievements = prev.achievements.map(a =>
          newAchIds.includes(a.id) ? { ...a, unlockedAt: new Date().toISOString() } : a
        );
        pendingAchievement = { id: firstId, title: def.title, description: def.description, icon: def.icon };
        AsyncStorage.setItem(STORAGE_KEYS.ACHIEVEMENTS, JSON.stringify(achievements));
      }

      return { ...prev, quests: updated, questChains, achievements, pendingAchievement };
    });
    await updateDomainScore("DISCIPLINE", 3.0, true);
    if (questSnapshot && usernameSnapshot) {
      void postQuestCompletionEvent({
        username: usernameSnapshot,
        questId: questSnapshot.id,
        status: "complete",
        domain: questSnapshot.domain,
        questType: questSnapshot.type,
      });
    }
  }, [state.quests, state.user?.username, updateDomainScore]);

  const refuseQuest = useCallback(async (questId: string) => {
    const questSnapshot = state.quests.find(q => q.id === questId);
    const usernameSnapshot = state.user?.username;
    setState(prev => {
      const updated = prev.quests.map(q => q.id === questId ? { ...q, status: "refused" as QuestStatus } : q);
      AsyncStorage.setItem(STORAGE_KEYS.QUESTS, JSON.stringify(updated));
      return { ...prev, quests: updated };
    });
    await updateDomainScore("DISCIPLINE", -1.5, false);
    if (questSnapshot && usernameSnapshot) {
      void postQuestCompletionEvent({
        username: usernameSnapshot,
        questId: questSnapshot.id,
        status: "refused",
        domain: questSnapshot.domain,
        questType: questSnapshot.type,
      });
    }
  }, [state.quests, state.user?.username, updateDomainScore]);

  const acknowledgeRankUp = useCallback(async () => {
    setState(prev => {
      if (!prev.pendingRankUp || !prev.user) return prev;
      const newUser = { ...prev.user, rank: prev.pendingRankUp.toRank };
      // Achievement for rank up
      const rankAchMap: Record<Rank, AchievementId | null> = {
        E: null, D: "rank_d", C: "rank_c", B: "rank_b", A: "rank_a", S: "rank_s",
      };
      const achId = rankAchMap[prev.pendingRankUp.toRank];
      let achievements = prev.achievements;
      let pendingAchievement = prev.pendingAchievement;
      if (achId && !prev.achievements.find(a => a.id === achId)?.unlockedAt && !prev.pendingAchievement) {
        const def = ACHIEVEMENT_DEFS[achId];
        achievements = prev.achievements.map(a => a.id === achId ? { ...a, unlockedAt: new Date().toISOString() } : a);
        pendingAchievement = { id: achId, title: def.title, description: def.description, icon: def.icon };
        AsyncStorage.setItem(STORAGE_KEYS.ACHIEVEMENTS, JSON.stringify(achievements));
      }
      AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(newUser));
      AsyncStorage.removeItem(STORAGE_KEYS.RANK_UP);
      return { ...prev, user: newUser, pendingRankUp: null, achievements, pendingAchievement };
    });
  }, []);

  const setPendingDebrief = useCallback(async (debrief: DebriefData) => {
    await AsyncStorage.setItem(STORAGE_KEYS.DEBRIEF, JSON.stringify(debrief));
    setState(prev => ({ ...prev, pendingDebrief: debrief }));
  }, []);

  const acknowledgeDebrief = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0]!;
    await AsyncStorage.setItem(STORAGE_KEYS.LAST_DEBRIEF, today);
    await AsyncStorage.removeItem(STORAGE_KEYS.DEBRIEF);
    setState(prev => {
      const newBaseline = makeBaseline(prev.domainScores);
      AsyncStorage.setItem(STORAGE_KEYS.BASELINE, JSON.stringify(newBaseline));
      return { ...prev, pendingDebrief: null, dailyBaseline: newBaseline };
    });
  }, []);

  const acknowledgeStreakBreak = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.STREAK_BREAK);
    setState(prev => ({ ...prev, pendingStreakBreak: null }));
  }, []);

  const getDomainScore = useCallback((domain: Domain): number => {
    return state.domainScores.find(s => s.domain === domain)?.score ?? 50;
  }, [state.domainScores]);

  const getWeakestDomain = useCallback((): Domain => {
    return state.domainScores.reduce((a, b) => a.score < b.score ? a : b).domain;
  }, [state.domainScores]);

  const getHiddenScore = useCallback((): number => {
    return computeHiddenScore(state.domainScores);
  }, [state.domainScores]);

  const computeRank = useCallback((score: number): Rank => {
    return computeRankFromScore(score);
  }, []);

  const getShadowScores = useCallback((): Record<Domain, number> => {
    return computeShadowScores(state.shadowSelf);
  }, [state.shadowSelf]);

  const getShadowRank = useCallback((): Rank => {
    const scores = computeShadowScores(state.shadowSelf);
    const avg = DOMAINS.reduce((s, d) => s + scores[d], 0) / DOMAINS.length;
    return computeRankFromScore(avg);
  }, [state.shadowSelf]);

  const getShadowPhase = useCallback((): ShadowPhase => {
    return computeShadowPhase(state.shadowSelf);
  }, [state.shadowSelf]);

  const updateRivals = useCallback(async (rivals: Rival[]) => {
    await AsyncStorage.setItem(STORAGE_KEYS.RIVALS, JSON.stringify(rivals));
    setState(prev => {
      const updatedChallenges = prev.challenges.map(c => {
        if (c.outcome !== null) return c;
        const rival = rivals.find(r => r.codename === c.rivalCodename);
        if (!rival) return c;
        const rivalScore =
          c.domain === "BODY" ? rival.bodyScore :
          c.domain === "MIND" ? rival.mindScore :
          c.domain === "WEALTH" ? rival.wealthScore :
          rival.disciplineScore;
        return { ...c, rivalCurrentScore: rivalScore };
      });
      AsyncStorage.setItem(STORAGE_KEYS.CHALLENGES, JSON.stringify(updatedChallenges));
      return { ...prev, rivals, challenges: updatedChallenges };
    });
  }, []);

  const declareChallenge = useCallback(async (rivalCodename: string, rivalRank: Rank, domain: Domain) => {
    setState(prev => {
      const rival = prev.rivals.find(r => r.codename === rivalCodename);
      if (!rival) return prev;
      const userScore = prev.domainScores.find(s => s.domain === domain)?.score ?? 50;
      const rivalScore =
        domain === "BODY" ? rival.bodyScore :
        domain === "MIND" ? rival.mindScore :
        domain === "WEALTH" ? rival.wealthScore :
        rival.disciplineScore;
      const startDate = new Date().toISOString().split("T")[0]!;
      const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;
      const challenge: Challenge = {
        id: generateId(), rivalCodename, rivalRank, domain, startDate, endDate,
        userStartScore: userScore, rivalStartScore: rivalScore,
        userCurrentScore: userScore, rivalCurrentScore: rivalScore,
        outcome: null, acknowledged: false,
      };
      const updated = [...prev.challenges, challenge];
      AsyncStorage.setItem(STORAGE_KEYS.CHALLENGES, JSON.stringify(updated));
      return { ...prev, challenges: updated };
    });
  }, []);

  const updateChallengeScores = useCallback(async (challenges: Challenge[]) => {
    await AsyncStorage.setItem(STORAGE_KEYS.CHALLENGES, JSON.stringify(challenges));
    setState(prev => ({ ...prev, challenges }));
  }, []);

  const acknowledgeChallenge = useCallback(async (challengeId: string) => {
    setState(prev => {
      const updated = prev.challenges.map(c => c.id === challengeId ? { ...c, acknowledged: true } : c);
      AsyncStorage.setItem(STORAGE_KEYS.CHALLENGES, JSON.stringify(updated));
      return { ...prev, challenges: updated };
    });
  }, []);

  const resolveExpiredChallenges = useCallback(() => {
    const today = new Date().toISOString().split("T")[0]!;
    setState(prev => {
      const hasPending = prev.challenges.some(c => c.outcome === null && c.endDate < today);
      if (!hasPending) return prev;
      let record = { ...prev.challengeRecord };
      const resolved = prev.challenges.map(c => {
        if (c.outcome !== null || c.endDate >= today) return c;
        const userGain = c.userCurrentScore - c.userStartScore;
        const rivalGain = c.rivalCurrentScore - c.rivalStartScore;
        const outcome: ChallengeOutcome = userGain > rivalGain ? "win" : userGain < rivalGain ? "loss" : "draw";
        record = {
          wins: record.wins + (outcome === "win" ? 1 : 0),
          losses: record.losses + (outcome === "loss" ? 1 : 0),
          draws: record.draws + (outcome === "draw" ? 1 : 0),
        };
        return { ...c, outcome };
      });
      AsyncStorage.setItem(STORAGE_KEYS.CHALLENGES, JSON.stringify(resolved));
      AsyncStorage.setItem(STORAGE_KEYS.CHALLENGE_RECORD, JSON.stringify(record));
      return { ...prev, challenges: resolved, challengeRecord: record };
    });
  }, []);

  const initializeShadowSelf = useCallback(async (userScores: Record<Domain, number>, username: string) => {
    const headStart = 12;
    const initialScores: Record<Domain, number> = {
      BODY: Math.min(100, (userScores.BODY ?? 50) + headStart),
      MIND: Math.min(100, (userScores.MIND ?? 50) + headStart),
      WEALTH: Math.min(100, (userScores.WEALTH ?? 50) + headStart),
      DISCIPLINE: Math.min(100, (userScores.DISCIPLINE ?? 50) + headStart),
    };
    const shadow: ShadowSelf = {
      active: true,
      codename: `SHADOW // ${username.toUpperCase()}`,
      initialScores,
      dailyGainRate: { BODY: 1.4, MIND: 1.2, WEALTH: 1.0, DISCIPLINE: 1.8 },
      activatedAt: new Date().toISOString(),
      gap: headStart,
    };
    await AsyncStorage.setItem(STORAGE_KEYS.SHADOW, JSON.stringify(shadow));
    setState(prev => ({ ...prev, shadowSelf: shadow }));
  }, []);

  // --- Quest chains ---

  const startQuestChain = useCallback(async (chainTemplate: Omit<QuestChain, "id" | "startedAt" | "currentStep" | "status">) => {
    const chain: QuestChain = {
      ...chainTemplate, id: generateId(),
      startedAt: new Date().toISOString(), currentStep: 0, status: "active",
    };
    setState(prev => {
      const updated = [...prev.questChains, chain];
      AsyncStorage.setItem(STORAGE_KEYS.QUEST_CHAINS, JSON.stringify(updated));
      // Also create the first quest for this chain
      const step = chain.steps[0];
      if (step) {
        const chainQuest: Quest = {
          id: generateId(), type: "arc",
          title: `[${chain.name}] ${step.title}`,
          description: `${step.description}\n\nReward: ${step.reward}`,
          domain: chain.domain, status: "active",
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          generatedBySystem: true, chainId: chain.id, chainStep: 0, chainTotal: chain.steps.length,
        };
        const updatedQuests = [...prev.quests, chainQuest];
        AsyncStorage.setItem(STORAGE_KEYS.QUESTS, JSON.stringify(updatedQuests));
        return { ...prev, questChains: updated, quests: updatedQuests };
      }
      return { ...prev, questChains: updated };
    });
  }, []);

  const advanceQuestChain = useCallback(async (chainId: string) => {
    setState(prev => {
      const chain = prev.questChains.find(c => c.id === chainId);
      if (!chain || chain.status !== "active") return prev;
      const nextStep = chain.currentStep + 1;
      if (nextStep >= chain.steps.length) {
        const updatedChains = prev.questChains.map(c =>
          c.id === chainId ? { ...c, currentStep: nextStep, status: "complete" as const } : c
        );
        AsyncStorage.setItem(STORAGE_KEYS.QUEST_CHAINS, JSON.stringify(updatedChains));
        return { ...prev, questChains: updatedChains };
      }
      const step = chain.steps[nextStep];
      if (!step) return prev;
      const chainQuest: Quest = {
        id: generateId(), type: "arc",
        title: `[${chain.name}] ${step.title}`,
        description: `${step.description}\n\nReward: ${step.reward}`,
        domain: chain.domain, status: "active",
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        generatedBySystem: true, chainId: chain.id, chainStep: nextStep, chainTotal: chain.steps.length,
      };
      const updatedChains = prev.questChains.map(c =>
        c.id === chainId ? { ...c, currentStep: nextStep } : c
      );
      const updatedQuests = [...prev.quests, chainQuest];
      AsyncStorage.setItem(STORAGE_KEYS.QUEST_CHAINS, JSON.stringify(updatedChains));
      AsyncStorage.setItem(STORAGE_KEYS.QUESTS, JSON.stringify(updatedQuests));
      return { ...prev, questChains: updatedChains, quests: updatedQuests };
    });
  }, []);

  // --- Rival taunts ---

  const addRivalTaunt = useCallback(async (taunt: Omit<RivalTaunt, "id" | "generatedAt" | "read">) => {
    const newTaunt: RivalTaunt = {
      ...taunt, id: generateId(), generatedAt: new Date().toISOString(), read: false,
    };
    setState(prev => {
      const updated = [...prev.rivalTaunts, newTaunt].slice(-20);
      AsyncStorage.setItem(STORAGE_KEYS.RIVAL_TAUNTS, JSON.stringify(updated));
      return { ...prev, rivalTaunts: updated };
    });
  }, []);

  const markRivalTauntsRead = useCallback(async () => {
    setState(prev => {
      const updated = prev.rivalTaunts.map(t => ({ ...t, read: true }));
      AsyncStorage.setItem(STORAGE_KEYS.RIVAL_TAUNTS, JSON.stringify(updated));
      return { ...prev, rivalTaunts: updated };
    });
  }, []);

  // --- Achievement / milestone acknowledgment ---

  const acknowledgePendingAchievement = useCallback(() => {
    setState(prev => ({ ...prev, pendingAchievement: null }));
  }, []);

  const acknowledgePendingMilestone = useCallback(() => {
    setState(prev => ({ ...prev, pendingMilestone: null }));
  }, []);

  // --- Weekly recap computation ---

  const getWeeklyRecapData = useCallback((): WeeklyRecapData => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const weekAgoStr = new Date(weekAgo).toISOString();
    const weekStartStr = new Date(weekAgo).toISOString().split("T")[0]!;

    const recentLogs = state.logs.filter(l => l.timestamp >= weekAgoStr);
    const recentQuests = state.quests.filter(q => q.status === "complete");
    const recentChallenges = state.challenges.filter(c => c.outcome !== null);

    // Domain gains: current vs 7 days ago (approximation from baseline or just current)
    const domainDeltas: Record<Domain, number> = {
      BODY: 0, MIND: 0, WEALTH: 0, DISCIPLINE: 0,
    };
    for (const d of DOMAINS) {
      const currentScore = state.domainScores.find(s => s.domain === d)?.score ?? 50;
      // Use logs count as proxy for delta
      const logsForDomain = recentLogs.filter(l => l.domain === d).length;
      domainDeltas[d] = parseFloat((logsForDomain * BASE_SCORE_DELTAS[d]).toFixed(1));
    }

    const peakDomain = DOMAINS.reduce((best, d) =>
      domainDeltas[d] > domainDeltas[best] ? d : best, "DISCIPLINE" as Domain
    );

    const challengeWins = recentChallenges.filter(c => c.outcome === "win").length;
    const challengeLosses = recentChallenges.filter(c => c.outcome === "loss").length;
    const chainsCompleted = state.questChains.filter(c => c.status === "complete").length;
    const achievementsUnlocked = state.achievements.filter(a => {
      if (!a.unlockedAt) return false;
      return new Date(a.unlockedAt).getTime() >= weekAgo;
    }).length;

    return {
      weekStart: weekStartStr,
      domainDeltas,
      questsCompleted: recentQuests.length,
      challengeWins,
      challengeLosses,
      logsCount: recentLogs.length,
      peakDomain,
      forbiddenLogs: recentLogs.filter(l => l.forbidden).length,
      chainsCompleted,
      achievementsUnlocked,
    };
  }, [state.logs, state.quests, state.challenges, state.domainScores, state.questChains, state.achievements]);

  const resetAll = useCallback(async () => {
    await Promise.all(Object.values(STORAGE_KEYS).map(k => AsyncStorage.removeItem(k)));
    setState({
      user: null,
      domainScores: DEFAULT_SCORES,
      logs: [],
      quests: [],
      questChains: [],
      rivals: DEFAULT_RIVALS,
      shadowSelf: DEFAULT_SHADOW,
      trajectory: "stable",
      loading: false,
      pendingRankUp: null,
      dailyBaseline: null,
      pendingDebrief: null,
      pendingStreakBreak: null,
      challenges: [],
      challengeRecord: DEFAULT_CHALLENGE_RECORD,
      achievements: initAchievements(),
      milestones: initMilestones(),
      rivalTaunts: [],
      pendingAchievement: null,
      pendingMilestone: null,
    });
  }, []);

  return (
    <AppContext.Provider value={{
      ...state,
      setUser,
      updateDomainScore,
      addLog,
      setQuests,
      completeQuest,
      refuseQuest,
      getDomainScore,
      getWeakestDomain,
      getHiddenScore,
      computeRank,
      getShadowScores,
      getShadowRank,
      getShadowPhase,
      updateRivals,
      declareChallenge,
      updateChallengeScores,
      acknowledgeChallenge,
      resolveExpiredChallenges,
      initializeShadowSelf,
      acknowledgeRankUp,
      setPendingDebrief,
      acknowledgeDebrief,
      acknowledgeStreakBreak,
      startQuestChain,
      advanceQuestChain,
      addRivalTaunt,
      markRivalTauntsRead,
      acknowledgePendingAchievement,
      acknowledgePendingMilestone,
      getWeeklyRecapData,
      resetAll,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
