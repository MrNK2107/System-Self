// Game state for the screens. Everything here comes from the server (GET /api/state, /api/logs, /api/quests,
// /api/chains/templates) through React Query; logs go through the outbox. No game rule is computed here.
// Rivals, challenges and taunts are still simulated on the device until P5 (useLocalRivals).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { BASE_LOG_DELTAS, streakMultiplier } from "@workspace/engine";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import {
  useChainsQuery,
  useGameStateQuery,
  useGameUserId,
  useLogsQuery,
  useOutboxSnapshot,
  useQuestsQuery,
} from "@/hooks/useGameState";
import { useLocalRivals } from "@/hooks/useLocalRivals";
import { api } from "@/lib/api/client";
import { getOutbox } from "@/lib/api/outbox";
import { useOnline } from "@/lib/api/query";
import {
  completeQuest as completeQuestRequest,
  discardFailedEntries,
  enqueueLog,
  generateQuests as generateQuestsRequest,
  newClientId,
  refuseQuest as refuseQuestRequest,
  retryFailedEntries,
  startChain,
  type LogInput,
  type MutationResult,
} from "@/lib/game/actions";
import { invalidateGame } from "@/lib/game/keys";
import { cleanupLegacyKeys } from "@/lib/game/legacy-cleanup";
import {
  DOMAINS,
  mergeLogs,
  pendingLogEntries,
  scoreRecord,
  toAchievements,
  toAppUser,
  toDomainScores,
  toMilestones,
  toQuest,
  toQuestChains,
  toShadowSelf,
  weakestDomain,
} from "@/lib/game/mappers";
import type {
  Achievement,
  Domain,
  DomainMilestone,
  DomainScore,
  LogEntry,
  Quest,
  QuestChain,
  Rank,
  ShadowPhase,
  ShadowSelf,
  Trajectory,
  User,
  WeeklyRecapData,
} from "@/lib/game/types";

export type * from "@/lib/game/types";
export type { LogInput } from "@/lib/game/actions";

// Display-only data from the shared engine (titles, icons, chain text). Never used to compute a score.
export { ACHIEVEMENT_DEFS, MILESTONE_TITLES, CHAIN_TEMPLATES as PREDEFINED_CHAINS } from "@workspace/engine";

/** Score multiplier a streak earns, for previews only (the server applies it). */
export const getStreakMultiplier = streakMultiplier;

export function getStreakTier(streak: number): "none" | "low" | "mid" | "high" | "max" {
  if (streak <= 0) return "none";
  if (streak <= 2) return "low";
  if (streak <= 6) return "mid";
  if (streak <= 9) return "high";
  return "max";
}

/** Outcome of a quest / chain request. `sync_pending`: older logs are still queued, nothing was sent. */
export type GameMutationResult = { ok: true } | { ok: false; reason: "sync_pending" } | { ok: false; reason: "error"; error: unknown };

interface AppContextType {
  user: User | null;
  domainScores: DomainScore[];
  logs: LogEntry[];
  quests: Quest[];
  questChains: QuestChain[];
  shadowSelf: ShadowSelf;
  trajectory: Trajectory;
  /** 0-100: how far the hidden score is through the current rank band (server-computed). */
  tierProgress: number;
  achievements: Achievement[];
  milestones: DomainMilestone[];
  /** No game state yet and the first request is still running. */
  loading: boolean;
  /** No game state could be loaded (cached data is shown instead whenever there is any). */
  loadError: unknown;
  refresh: () => Promise<void>;

  getDomainScore: (domain: Domain) => number;
  getWeakestDomain: () => Domain;
  getShadowScores: () => Record<Domain, number>;
  getShadowRank: () => Rank;
  getShadowPhase: () => ShadowPhase;

  /** Queues the log in the outbox and starts a flush; it shows as pending until the server has it. */
  addLog: (entry: LogInput) => Promise<void>;
  completeQuest: (questId: string) => Promise<GameMutationResult>;
  refuseQuest: (questId: string, reason?: string) => Promise<GameMutationResult>;
  startQuestChain: (templateKey: string) => Promise<GameMutationResult>;
  generateQuests: () => Promise<GameMutationResult>;

  /** A mutation was held back because queued logs could not be sent (OFFLINE bar shows it). */
  syncBlocked: boolean;
  offline: boolean;
  pendingCount: number;
  failedCount: number;
  retryFailed: () => Promise<void>;
  discardFailed: () => Promise<void>;

  // P3-T6: recap moves to GET /api/recap/weekly; this is a display-only placeholder until then.
  getWeeklyRecapData: () => WeeklyRecapData;

  // Local until P5.
  rivals: ReturnType<typeof useLocalRivals>["rivals"];
  challenges: ReturnType<typeof useLocalRivals>["challenges"];
  challengeRecord: ReturnType<typeof useLocalRivals>["challengeRecord"];
  rivalTaunts: ReturnType<typeof useLocalRivals>["rivalTaunts"];
  updateRivals: ReturnType<typeof useLocalRivals>["updateRivals"];
  declareChallenge: ReturnType<typeof useLocalRivals>["declareChallenge"];
  updateChallengeScores: ReturnType<typeof useLocalRivals>["updateChallengeScores"];
  acknowledgeChallenge: ReturnType<typeof useLocalRivals>["acknowledgeChallenge"];
  resolveExpiredChallenges: ReturnType<typeof useLocalRivals>["resolveExpiredChallenges"];
  addRivalTaunt: ReturnType<typeof useLocalRivals>["addRivalTaunt"];
  markRivalTauntsRead: ReturnType<typeof useLocalRivals>["markRivalTauntsRead"];
}

const AppContext = createContext<AppContextType | null>(null);

function flushOutboxSoon() {
  void getOutbox()
    .flush()
    .catch(() => undefined);
}

/** Runs the one-time removal of the old local game keys before any screen reads storage. */
function useLegacyCleanup(): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    cleanupLegacyKeys(AsyncStorage)
      .catch(() => 0) // retried on the next launch
      .finally(() => setDone(true));
  }, []);
  return done;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const cleaned = useLegacyCleanup();
  const queryClient = useQueryClient();
  const { user: authUser } = useAuth();
  const userId = useGameUserId();
  const online = useOnline();

  const stateQ = useGameStateQuery();
  const logsQ = useLogsQuery();
  const questsQ = useQuestsQuery();
  const chainsQ = useChainsQuery();
  const outboxSnap = useOutboxSnapshot();
  const [syncBlocked, setSyncBlocked] = useState(false);

  const state = stateQ.data;

  const user = useMemo(
    () => (state && authUser ? toAppUser(state.profile, authUser) : null),
    [state, authUser],
  );
  const domainScores = useMemo(() => toDomainScores(state?.scores ?? []), [state]);
  const shadowSelf = useMemo(() => toShadowSelf(state?.shadow ?? null), [state]);
  const achievements = useMemo(() => toAchievements(state?.achievements ?? []), [state]);
  const milestones = useMemo(() => toMilestones(state?.milestones ?? []), [state]);
  const logs = useMemo(
    () => mergeLogs(logsQ.data ?? [], pendingLogEntries(outboxSnap.pending)),
    [logsQ.data, outboxSnap.pending],
  );
  const quests = useMemo(
    () => (questsQ.data ? [...questsQ.data.active, ...questsQ.data.recent].map(toQuest) : []),
    [questsQ.data],
  );
  const questChains = useMemo(() => (chainsQ.data ? toQuestChains(chainsQ.data) : []), [chainsQ.data]);
  const trajectory: Trajectory = state?.trajectory ?? "stable";
  const tierProgress = state?.tierProgress ?? 0;

  const rivalsState = useLocalRivals(domainScores);

  // Whenever queued items leave the outbox (sent or parked), the server state changed: refetch.
  const pendingCount = outboxSnap.pending.length;
  const prevPending = useRef(pendingCount);
  useEffect(() => {
    if (pendingCount < prevPending.current) void invalidateGame(queryClient, userId);
    if (pendingCount === 0) setSyncBlocked(false);
    prevPending.current = pendingCount;
  }, [pendingCount, queryClient, userId]);

  const refresh = useCallback(async () => {
    flushOutboxSoon();
    await Promise.all([stateQ.refetch(), logsQ.refetch(), questsQ.refetch(), chainsQ.refetch()]);
  }, [stateQ, logsQ, questsQ, chainsQ]);

  const addLog = useCallback(async (entry: LogInput) => {
    await enqueueLog(getOutbox(), entry);
    flushOutboxSoon();
  }, []);

  const runGuarded = useCallback(
    async (prefix: string, send: (clientId: string) => Promise<MutationResult<unknown>>): Promise<GameMutationResult> => {
      try {
        const r = await send(newClientId(prefix));
        if (!r.ok) {
          setSyncBlocked(true);
          return { ok: false, reason: "sync_pending" };
        }
        setSyncBlocked(false);
        return { ok: true };
      } catch (error) {
        return { ok: false, reason: "error", error };
      } finally {
        void invalidateGame(queryClient, userId);
      }
    },
    [queryClient, userId],
  );

  const completeQuest = useCallback(
    (questId: string) => runGuarded("quest-complete", (id) => completeQuestRequest(api, getOutbox(), questId, id)),
    [runGuarded],
  );
  const refuseQuest = useCallback(
    (questId: string, reason?: string) =>
      runGuarded("quest-refuse", (id) => refuseQuestRequest(api, getOutbox(), questId, reason, id)),
    [runGuarded],
  );
  const startQuestChain = useCallback(
    (templateKey: string) => runGuarded("chain", (id) => startChain(api, getOutbox(), templateKey, id)),
    [runGuarded],
  );
  const generateQuests = useCallback(
    () => runGuarded("quest-generate", (id) => generateQuestsRequest(api, getOutbox(), id)),
    [runGuarded],
  );

  const retryFailed = useCallback(async () => {
    await retryFailedEntries(getOutbox());
    flushOutboxSoon();
  }, []);
  const discardFailed = useCallback(() => discardFailedEntries(getOutbox()), []);

  const getDomainScore = useCallback(
    (domain: Domain) => domainScores.find((s) => s.domain === domain)?.score ?? 0,
    [domainScores],
  );
  const getWeakestDomain = useCallback(() => weakestDomain(domainScores), [domainScores]);
  const getShadowScores = useCallback(() => shadowSelf.scores, [shadowSelf]);
  const getShadowRank = useCallback(() => shadowSelf.rank, [shadowSelf]);
  const getShadowPhase = useCallback(() => shadowSelf.phase, [shadowSelf]);

  // P3-T6: replaced by GET /api/recap/weekly. Counts only; the domain deltas are a display estimate.
  const getWeeklyRecapData = useCallback((): WeeklyRecapData => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekAgoIso = new Date(weekAgo).toISOString();
    const recent = logs.filter((l) => l.timestamp >= weekAgoIso);
    const domainDeltas = {} as Record<Domain, number>;
    for (const d of DOMAINS) {
      domainDeltas[d] = parseFloat((recent.filter((l) => l.domain === d).length * BASE_LOG_DELTAS[d]).toFixed(1));
    }
    const peakDomain = DOMAINS.reduce((best, d) => (domainDeltas[d] > domainDeltas[best] ? d : best), "DISCIPLINE" as Domain);
    const resolved = rivalsState.challenges.filter((c) => c.outcome !== null);
    return {
      weekStart: weekAgoIso.split("T")[0]!,
      domainDeltas,
      questsCompleted: quests.filter((q) => q.status === "complete").length,
      challengeWins: resolved.filter((c) => c.outcome === "win").length,
      challengeLosses: resolved.filter((c) => c.outcome === "loss").length,
      logsCount: recent.length,
      peakDomain,
      forbiddenLogs: recent.filter((l) => l.forbidden).length,
      chainsCompleted: 0,
      achievementsUnlocked: achievements.filter((a) => a.unlockedAt && new Date(a.unlockedAt).getTime() >= weekAgo).length,
    };
  }, [logs, quests, achievements, rivalsState.challenges]);

  const value = useMemo<AppContextType>(
    () => ({
      user,
      domainScores,
      logs,
      quests,
      questChains,
      shadowSelf,
      trajectory,
      tierProgress,
      achievements,
      milestones,
      loading: !state && !stateQ.isError,
      loadError: state ? null : stateQ.error,
      refresh,
      getDomainScore,
      getWeakestDomain,
      getShadowScores,
      getShadowRank,
      getShadowPhase,
      addLog,
      completeQuest,
      refuseQuest,
      startQuestChain,
      generateQuests,
      syncBlocked,
      offline: !online,
      pendingCount,
      failedCount: outboxSnap.failed.length,
      retryFailed,
      discardFailed,
      getWeeklyRecapData,
      ...rivalsState,
    }),
    [
      user, domainScores, logs, quests, questChains, shadowSelf, trajectory, tierProgress, achievements, milestones,
      state, stateQ.isError, stateQ.error, refresh, getDomainScore, getWeakestDomain, getShadowScores, getShadowRank,
      getShadowPhase, addLog, completeQuest, refuseQuest, startQuestChain, generateQuests, syncBlocked, online,
      pendingCount, outboxSnap.failed.length, retryFailed, discardFailed, getWeeklyRecapData, rivalsState,
    ],
  );

  if (!cleaned) return null;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

/** Re-exported for screens that list domains. */
export { scoreRecord };
