import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Domain = "BODY" | "MIND" | "WEALTH" | "DISCIPLINE";
export type Rank = "E" | "D" | "C" | "B" | "A" | "S";
export type QuestType = "daily" | "weekly" | "arc";
export type QuestStatus = "active" | "complete" | "failed" | "refused";
export type Trajectory = "up" | "stable" | "down";
export type DebriefVerdict = "ACCEPTABLE" | "INSUFFICIENT" | "PATHETIC";

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
}

export interface ShadowSelf {
  active: boolean;
  codename: string;
  initialScores: Record<Domain, number>;
  dailyGainRate: Record<Domain, number>;
  activatedAt: string | null;
  gap: number;
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

const RANK_ORDER: Record<Rank, number> = { E: 0, D: 1, C: 2, B: 3, A: 4, S: 5 };
const CODENAME_PREFIXES: Record<Rank, string> = {
  E: "GHOST",
  D: "VECTOR",
  C: "CIPHER",
  B: "PHANTOM",
  A: "WRAITH",
  S: "ORACLE",
};

function generateCodename(rank: Rank): string {
  const id = Math.random().toString(36).substr(2, 3).toUpperCase();
  const num = Math.floor(Math.random() * 9) + 1;
  return `${CODENAME_PREFIXES[rank]} // ${id}-${num}`;
}

// --- types ------------------------------------------------------------------

interface AppState {
  user: User | null;
  domainScores: DomainScore[];
  logs: LogEntry[];
  quests: Quest[];
  rivals: Rival[];
  shadowSelf: ShadowSelf;
  trajectory: Trajectory;
  loading: boolean;
  pendingRankUp: PendingRankUp | null;
  dailyBaseline: DailyBaseline | null;
  pendingDebrief: DebriefData | null;
  pendingStreakBreak: StreakBreakData | null;
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
  initializeShadowSelf: (userScores: Record<Domain, number>, username: string) => Promise<void>;
  acknowledgeRankUp: () => Promise<void>;
  setPendingDebrief: (debrief: DebriefData) => Promise<void>;
  acknowledgeDebrief: () => Promise<void>;
  acknowledgeStreakBreak: () => Promise<void>;
  resetAll: () => Promise<void>;
}

// --- storage ----------------------------------------------------------------

const STORAGE_KEYS = {
  USER: "@system_self:user",
  SCORES: "@system_self:scores",
  LOGS: "@system_self:logs",
  QUESTS: "@system_self:quests",
  RIVALS: "@system_self:rivals",
  SHADOW: "@system_self:shadow",
  RANK_UP: "@system_self:rank_up",
  BASELINE: "@system_self:baseline",
  DEBRIEF: "@system_self:debrief",
  LAST_DEBRIEF: "@system_self:last_debrief",
  STREAK_BREAK: "@system_self:streak_break",
};

export { STORAGE_KEYS };

// --- constants --------------------------------------------------------------

const DOMAINS: Domain[] = ["BODY", "MIND", "WEALTH", "DISCIPLINE"];

const BASE_SCORE_DELTAS: Record<Domain, number> = {
  BODY: 2.5,
  MIND: 2.5,
  WEALTH: 2.0,
  DISCIPLINE: 3.0,
};

const DEFAULT_SCORES: DomainScore[] = DOMAINS.map(d => ({
  domain: d,
  score: 50,
  streak: 0,
  lastLog: null,
}));

const DEFAULT_RIVALS: Rival[] = [
  {
    codename: "RIVAL // ECHO-7",
    rank: "D",
    bodyScore: 52.3,
    mindScore: 48.1,
    wealthScore: 55.0,
    disciplineScore: 49.5,
    trajectory: "up",
    shadowActive: false,
  },
  {
    codename: "RIVAL // PHANTOM-3",
    rank: "D",
    bodyScore: 47.8,
    mindScore: 53.2,
    wealthScore: 44.5,
    disciplineScore: 51.0,
    trajectory: "stable",
    shadowActive: true,
  },
];

const DEFAULT_SHADOW: ShadowSelf = {
  active: false,
  codename: "SHADOW // SELF",
  initialScores: { BODY: 60, MIND: 60, WEALTH: 60, DISCIPLINE: 60 },
  dailyGainRate: { BODY: 1.5, MIND: 1.2, WEALTH: 1.0, DISCIPLINE: 1.8 },
  activatedAt: null,
  gap: 0,
};

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

/** Detect domains whose streaks were broken (lastLog < yesterday and streak > 0) */
function detectStreakBreaks(scores: DomainScore[]): { domain: Domain; lostStreak: number }[] {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0]!;

  return scores
    .filter(s => s.streak > 0 && s.lastLog !== null && s.lastLog < yesterdayStr)
    .map(s => ({ domain: s.domain, lostStreak: s.streak }));
}

// --- context ----------------------------------------------------------------

const AppContext = createContext<AppContextType | null>(null);

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// --- provider ---------------------------------------------------------------

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>({
    user: null,
    domainScores: DEFAULT_SCORES,
    logs: [],
    quests: [],
    rivals: DEFAULT_RIVALS,
    shadowSelf: DEFAULT_SHADOW,
    trajectory: "stable",
    loading: true,
    pendingRankUp: null,
    dailyBaseline: null,
    pendingDebrief: null,
    pendingStreakBreak: null,
  });

  useEffect(() => {
    loadFromStorage();
  }, []);

  const loadFromStorage = async () => {
    try {
      const [
        userStr, scoresStr, logsStr, questsStr, rivalsStr, shadowStr,
        rankUpStr, baselineStr, debriefStr, streakBreakStr,
      ] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.USER),
        AsyncStorage.getItem(STORAGE_KEYS.SCORES),
        AsyncStorage.getItem(STORAGE_KEYS.LOGS),
        AsyncStorage.getItem(STORAGE_KEYS.QUESTS),
        AsyncStorage.getItem(STORAGE_KEYS.RIVALS),
        AsyncStorage.getItem(STORAGE_KEYS.SHADOW),
        AsyncStorage.getItem(STORAGE_KEYS.RANK_UP),
        AsyncStorage.getItem(STORAGE_KEYS.BASELINE),
        AsyncStorage.getItem(STORAGE_KEYS.DEBRIEF),
        AsyncStorage.getItem(STORAGE_KEYS.STREAK_BREAK),
      ]);

      const user = userStr ? JSON.parse(userStr) as User : null;
      let domainScores = scoresStr ? JSON.parse(scoresStr) as DomainScore[] : DEFAULT_SCORES;
      const logs = logsStr ? JSON.parse(logsStr) as LogEntry[] : [];
      const quests = questsStr ? JSON.parse(questsStr) as Quest[] : [];
      const rivals = rivalsStr ? JSON.parse(rivalsStr) as Rival[] : DEFAULT_RIVALS;
      const shadow = shadowStr ? JSON.parse(shadowStr) as ShadowSelf : DEFAULT_SHADOW;
      const pendingRankUp = rankUpStr ? JSON.parse(rankUpStr) as PendingRankUp : null;
      const pendingDebrief = debriefStr ? JSON.parse(debriefStr) as DebriefData : null;

      // --- Streak break detection ---
      let pendingStreakBreak: StreakBreakData | null = streakBreakStr
        ? JSON.parse(streakBreakStr) as StreakBreakData
        : null;

      if (!pendingStreakBreak) {
        const broken = detectStreakBreaks(domainScores);
        if (broken.length > 0) {
          // Penalty: 2 pts per domain broken, capped at 6
          const penalty = Math.min(6.0, broken.length * 2.0);

          // Reset streaks for broken domains + apply DISCIPLINE penalty
          domainScores = domainScores.map(s => {
            if (broken.find(b => b.domain === s.domain)) {
              return { ...s, streak: 0 };
            }
            if (s.domain === "DISCIPLINE") {
              return { ...s, score: Math.max(0, s.score - penalty) };
            }
            return s;
          });

          await AsyncStorage.setItem(STORAGE_KEYS.SCORES, JSON.stringify(domainScores));

          pendingStreakBreak = {
            detectedAt: new Date().toISOString(),
            brokenDomains: broken,
            penalty,
            aiText: "",
          };
          await AsyncStorage.setItem(STORAGE_KEYS.STREAK_BREAK, JSON.stringify(pendingStreakBreak));
        }
      }

      // --- Daily baseline ---
      const today = new Date().toISOString().split("T")[0]!;
      let dailyBaseline: DailyBaseline | null = baselineStr
        ? JSON.parse(baselineStr) as DailyBaseline
        : null;
      if (!dailyBaseline || dailyBaseline.date !== today) {
        dailyBaseline = makeBaseline(domainScores);
        await AsyncStorage.setItem(STORAGE_KEYS.BASELINE, JSON.stringify(dailyBaseline));
      }

      const gap = shadow.active ? computeShadowGap(shadow, domainScores) : 0;
      const trajectory = computeTrajectory(domainScores);

      setState(prev => ({
        ...prev,
        user,
        domainScores,
        logs,
        quests,
        rivals,
        shadowSelf: { ...shadow, gap },
        trajectory,
        loading: false,
        pendingRankUp,
        dailyBaseline,
        pendingDebrief,
        pendingStreakBreak,
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
      const multiplier = applyStreakBonus && delta > 0
        ? getStreakMultiplier(currentStreak)
        : 1.0;
      const actualDelta = Math.round(delta * multiplier * 10) / 10;

      const updated = prev.domainScores.map(s => {
        if (s.domain !== domain) return s;
        const newScore = Math.min(100, Math.max(0, s.score + actualDelta));
        const today = new Date().toISOString().split("T")[0]!;
        const wasToday = s.lastLog === today;
        return {
          ...s,
          score: newScore,
          streak: wasToday ? s.streak : s.streak + 1,
          lastLog: today,
        };
      });

      const newHiddenScore = computeHiddenScore(updated);
      const newRank = computeRankFromScore(newHiddenScore);
      const currentRank = prev.user.rank;
      const gap = prev.shadowSelf.active ? computeShadowGap(prev.shadowSelf, updated) : 0;
      const trajectory = computeTrajectory(updated);

      let pendingRankUp = prev.pendingRankUp;
      if (RANK_ORDER[newRank] > RANK_ORDER[currentRank] && !prev.pendingRankUp) {
        pendingRankUp = {
          fromRank: currentRank,
          toRank: newRank,
          newCodename: generateCodename(newRank),
        };
        AsyncStorage.setItem(STORAGE_KEYS.RANK_UP, JSON.stringify(pendingRankUp));
      }

      AsyncStorage.setItem(STORAGE_KEYS.SCORES, JSON.stringify(updated));
      return {
        ...prev,
        domainScores: updated,
        trajectory,
        shadowSelf: { ...prev.shadowSelf, gap },
        pendingRankUp,
      };
    });
  }, []);

  const addLog = useCallback(async (entry: Omit<LogEntry, "id" | "timestamp">) => {
    const newEntry: LogEntry = {
      ...entry,
      id: generateId(),
      timestamp: new Date().toISOString(),
    };
    setState(prev => {
      const updated = [...prev.logs, newEntry];
      if (updated.length > 200) updated.splice(0, updated.length - 200);
      AsyncStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(updated));
      return { ...prev, logs: updated };
    });
    await updateDomainScore(entry.domain, BASE_SCORE_DELTAS[entry.domain], true);
  }, [updateDomainScore]);

  const setQuests = useCallback(async (quests: Quest[]) => {
    await AsyncStorage.setItem(STORAGE_KEYS.QUESTS, JSON.stringify(quests));
    setState(prev => ({ ...prev, quests }));
  }, []);

  const completeQuest = useCallback(async (questId: string) => {
    setState(prev => {
      const updated = prev.quests.map(q =>
        q.id === questId ? { ...q, status: "complete" as QuestStatus } : q
      );
      AsyncStorage.setItem(STORAGE_KEYS.QUESTS, JSON.stringify(updated));
      return { ...prev, quests: updated };
    });
    await updateDomainScore("DISCIPLINE", 3.0, true);
  }, [updateDomainScore]);

  const refuseQuest = useCallback(async (questId: string) => {
    setState(prev => {
      const updated = prev.quests.map(q =>
        q.id === questId ? { ...q, status: "refused" as QuestStatus } : q
      );
      AsyncStorage.setItem(STORAGE_KEYS.QUESTS, JSON.stringify(updated));
      return { ...prev, quests: updated };
    });
    await updateDomainScore("DISCIPLINE", -1.5, false);
  }, [updateDomainScore]);

  const acknowledgeRankUp = useCallback(async () => {
    setState(prev => {
      if (!prev.pendingRankUp || !prev.user) return prev;
      const newUser = { ...prev.user, rank: prev.pendingRankUp.toRank };
      AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(newUser));
      AsyncStorage.removeItem(STORAGE_KEYS.RANK_UP);
      return { ...prev, user: newUser, pendingRankUp: null };
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

  const initializeShadowSelf = useCallback(
    async (userScores: Record<Domain, number>, username: string) => {
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
    },
    []
  );

  const resetAll = useCallback(async () => {
    await Promise.all(Object.values(STORAGE_KEYS).map(k => AsyncStorage.removeItem(k)));
    setState({
      user: null,
      domainScores: DEFAULT_SCORES,
      logs: [],
      quests: [],
      rivals: DEFAULT_RIVALS,
      shadowSelf: DEFAULT_SHADOW,
      trajectory: "stable",
      loading: false,
      pendingRankUp: null,
      dailyBaseline: null,
      pendingDebrief: null,
      pendingStreakBreak: null,
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
      initializeShadowSelf,
      acknowledgeRankUp,
      setPendingDebrief,
      acknowledgeDebrief,
      acknowledgeStreakBreak,
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
