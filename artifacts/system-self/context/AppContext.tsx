import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Domain = "BODY" | "MIND" | "WEALTH" | "DISCIPLINE";
export type Rank = "E" | "D" | "C" | "B" | "A" | "S";
export type QuestType = "daily" | "weekly" | "arc";
export type QuestStatus = "active" | "complete" | "failed" | "refused";
export type Trajectory = "up" | "stable" | "down";

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
  gap: number;
  activatedAt: string | null;
}

interface AppState {
  user: User | null;
  domainScores: DomainScore[];
  logs: LogEntry[];
  quests: Quest[];
  rivals: Rival[];
  shadowSelf: ShadowSelf;
  trajectory: Trajectory;
  loading: boolean;
}

interface AppContextType extends AppState {
  setUser: (user: User) => Promise<void>;
  updateDomainScore: (domain: Domain, delta: number) => Promise<void>;
  addLog: (entry: Omit<LogEntry, "id" | "timestamp">) => Promise<void>;
  setQuests: (quests: Quest[]) => Promise<void>;
  completeQuest: (questId: string) => Promise<void>;
  refuseQuest: (questId: string) => Promise<void>;
  getDomainScore: (domain: Domain) => number;
  getWeakestDomain: () => Domain;
  getHiddenScore: () => number;
  computeRank: (hiddenScore: number) => Rank;
  resetAll: () => Promise<void>;
}

const STORAGE_KEYS = {
  USER: "@system_self:user",
  SCORES: "@system_self:scores",
  LOGS: "@system_self:logs",
  QUESTS: "@system_self:quests",
  RIVALS: "@system_self:rivals",
  SHADOW: "@system_self:shadow",
};

const DEFAULT_SCORES: DomainScore[] = [
  { domain: "BODY", score: 50, streak: 0, lastLog: null },
  { domain: "MIND", score: 50, streak: 0, lastLog: null },
  { domain: "WEALTH", score: 50, streak: 0, lastLog: null },
  { domain: "DISCIPLINE", score: 50, streak: 0, lastLog: null },
];

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

const AppContext = createContext<AppContextType | null>(null);

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>({
    user: null,
    domainScores: DEFAULT_SCORES,
    logs: [],
    quests: [],
    rivals: DEFAULT_RIVALS,
    shadowSelf: { active: false, gap: 0, activatedAt: null },
    trajectory: "stable",
    loading: true,
  });

  useEffect(() => {
    loadFromStorage();
  }, []);

  const loadFromStorage = async () => {
    try {
      const [userStr, scoresStr, logsStr, questsStr, rivalsStr, shadowStr] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.USER),
        AsyncStorage.getItem(STORAGE_KEYS.SCORES),
        AsyncStorage.getItem(STORAGE_KEYS.LOGS),
        AsyncStorage.getItem(STORAGE_KEYS.QUESTS),
        AsyncStorage.getItem(STORAGE_KEYS.RIVALS),
        AsyncStorage.getItem(STORAGE_KEYS.SHADOW),
      ]);

      const user = userStr ? JSON.parse(userStr) as User : null;
      const domainScores = scoresStr ? JSON.parse(scoresStr) as DomainScore[] : DEFAULT_SCORES;
      const logs = logsStr ? JSON.parse(logsStr) as LogEntry[] : [];
      const quests = questsStr ? JSON.parse(questsStr) as Quest[] : [];
      const rivals = rivalsStr ? JSON.parse(rivalsStr) as Rival[] : DEFAULT_RIVALS;
      const shadowSelf = shadowStr ? JSON.parse(shadowStr) as ShadowSelf : { active: false, gap: 0, activatedAt: null };
      const trajectory = computeTrajectory(domainScores);

      setState(prev => ({
        ...prev,
        user,
        domainScores,
        logs,
        quests,
        rivals,
        shadowSelf,
        trajectory,
        loading: false,
      }));
    } catch {
      setState(prev => ({ ...prev, loading: false }));
    }
  };

  const setUser = useCallback(async (user: User) => {
    await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    setState(prev => ({ ...prev, user }));
  }, []);

  const updateDomainScore = useCallback(async (domain: Domain, delta: number) => {
    setState(prev => {
      const updated = prev.domainScores.map(s => {
        if (s.domain !== domain) return s;
        const newScore = Math.min(100, Math.max(0, s.score + delta));
        const today = new Date().toISOString().split("T")[0];
        const wasToday = s.lastLog === today;
        return {
          ...s,
          score: newScore,
          streak: wasToday ? s.streak : s.streak + 1,
          lastLog: today,
        };
      });
      const trajectory = computeTrajectory(updated);
      AsyncStorage.setItem(STORAGE_KEYS.SCORES, JSON.stringify(updated));
      return { ...prev, domainScores: updated, trajectory };
    });
  }, []);

  const addLog = useCallback(async (entry: Omit<LogEntry, "id" | "timestamp">) => {
    const newEntry: LogEntry = {
      ...entry,
      id: generateId(),
      timestamp: new Date().toISOString(),
    };

    const domainDeltas: Record<Domain, number> = {
      BODY: 2.5,
      MIND: 2.5,
      WEALTH: 2.0,
      DISCIPLINE: 3.0,
    };

    setState(prev => {
      const updated = [...prev.logs, newEntry];
      if (updated.length > 200) updated.splice(0, updated.length - 200);
      AsyncStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(updated));
      return { ...prev, logs: updated };
    });

    await updateDomainScore(entry.domain, domainDeltas[entry.domain]);
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
    await updateDomainScore("DISCIPLINE", 3.0);
  }, [updateDomainScore]);

  const refuseQuest = useCallback(async (questId: string) => {
    setState(prev => {
      const updated = prev.quests.map(q =>
        q.id === questId ? { ...q, status: "refused" as QuestStatus } : q
      );
      AsyncStorage.setItem(STORAGE_KEYS.QUESTS, JSON.stringify(updated));
      return { ...prev, quests: updated };
    });
    await updateDomainScore("DISCIPLINE", -1.5);
  }, [updateDomainScore]);

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

  const resetAll = useCallback(async () => {
    await Promise.all(Object.values(STORAGE_KEYS).map(k => AsyncStorage.removeItem(k)));
    setState({
      user: null,
      domainScores: DEFAULT_SCORES,
      logs: [],
      quests: [],
      rivals: DEFAULT_RIVALS,
      shadowSelf: { active: false, gap: 0, activatedAt: null },
      trajectory: "stable",
      loading: false,
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
