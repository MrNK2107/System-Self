// Game state for the screens. Everything here comes from the server (GET /api/state, /api/logs, /api/quests,
// /api/chains/templates) through React Query; logs go through the outbox. No game rule is computed here.
// Rivals, challenges and taunts live on the server too (GET /api/rivals, hooks/useRivals.ts).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import type { FloorRoutineDto, SeasonKind } from "@workspace/contracts";
import { streakMultiplier } from "@workspace/engine";
import type { OutboxItem } from "@/lib/api/outbox";
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
  setQuestSlot as setQuestSlotRequest,
  setHomePath as setHomePathRequest,
  retryFailedEntries,
  startChain,
  type LogInput,
  type MutationResult,
} from "@/lib/game/actions";
import { invalidateGame } from "@/lib/game/keys";
import { cancelSeason as cancelSeasonRequest, scheduleSeason as scheduleSeasonRequest } from "@/lib/game/life";
import { pendingSetChanged, trackSentLogs } from "@/lib/game/pending";
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
  toChainTemplates,
  toQuestChains,
  toShadowSelf,
  weakestDomain,
} from "@/lib/game/mappers";
import type {
  Achievement,
  ChainTemplate,
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
export type GameMutationResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; reason: "sync_pending" }
  | { ok: false; reason: "error"; error: unknown };

/** What a successful refusal returns: the floor routine on offer (BODY quests only) and the Shadow takeover. */
export type RefuseOutcome = { floor: FloorRoutineDto | null; shadowTook: { questTitle: string } | null };

interface AppContextType {
  user: User | null;
  domainScores: DomainScore[];
  logs: LogEntry[];
  quests: Quest[];
  /** When the quest list was last fetched (ms since epoch); slot states are as of then. */
  questsUpdatedAt: number;
  questChains: QuestChain[];
  /** Every chain the server offers (GET /api/chains/templates), started or not. */
  chainTemplates: ChainTemplate[];
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
  /** No quest list could be loaded (GET /api/quests) and none is cached. */
  questsLoadError: unknown;
  refresh: () => Promise<void>;

  getDomainScore: (domain: Domain) => number;
  getWeakestDomain: () => Domain;
  getShadowScores: () => Record<Domain, number>;
  getShadowRank: () => Rank;
  getShadowPhase: () => ShadowPhase;

  /** Queues the log in the outbox and starts a flush; it shows as pending until the server has it. */
  addLog: (entry: LogInput) => Promise<void>;
  completeQuest: (questId: string) => Promise<GameMutationResult>;
  refuseQuest: (questId: string, reason: string) => Promise<GameMutationResult<RefuseOutcome>>;
  /** Lock the Slot for an active quest; null clears it. */
  setQuestSlot: (questId: string, slot: { slotStart: string; slotEnd: string } | null) => Promise<GameMutationResult>;
  /** Opt in to or out of the home path (Tier I home sessions before the gym). */
  setHomePath: (active: boolean) => Promise<GameMutationResult>;
  /** Schedules a season (from tomorrow, 1-14 days). */
  scheduleSeason: (input: { kind: SeasonKind; startsOn: string; lengthDays: number }) => Promise<GameMutationResult>;
  /** Cancels a scheduled season (not one that has started). */
  cancelSeason: (id: string) => Promise<GameMutationResult>;
  startQuestChain: (templateKey: string) => Promise<GameMutationResult>;
  generateQuests: () => Promise<GameMutationResult>;

  /** A mutation was held back because queued logs could not be sent (OFFLINE bar shows it). */
  syncBlocked: boolean;
  offline: boolean;
  pendingCount: number;
  failedCount: number;
  retryFailed: () => Promise<void>;
  discardFailed: () => Promise<void>;
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
  // Logs that just left the outbox stay listed until the logs query returns them (no pending -> gone -> back flicker).
  const [recentlySent, setRecentlySent] = useState<ReadonlyMap<string, LogEntry>>(() => new Map());
  const prevPendingItems = useRef<readonly OutboxItem[]>([]);
  useEffect(() => {
    const prev = prevPendingItems.current;
    prevPendingItems.current = outboxSnap.pending;
    const failedIds = new Set(outboxSnap.failed.map((f) => f.item.clientId));
    const serverIds = new Set((logsQ.data ?? []).map((l) => l.clientId));
    setRecentlySent((r) => trackSentLogs(r, prev, outboxSnap.pending, failedIds, serverIds));
  }, [outboxSnap.pending, outboxSnap.failed, logsQ.data]);
  useEffect(() => {
    setRecentlySent(new Map()); // a different account starts clean
  }, [userId]);

  const logs = useMemo(
    () => mergeLogs(logsQ.data ?? [], [...recentlySent.values(), ...pendingLogEntries(outboxSnap.pending)]),
    [logsQ.data, outboxSnap.pending, recentlySent],
  );
  const quests = useMemo(
    () => (questsQ.data ? [...questsQ.data.active, ...questsQ.data.recent].map(toQuest) : []),
    [questsQ.data],
  );
  const questChains = useMemo(() => (chainsQ.data ? toQuestChains(chainsQ.data) : []), [chainsQ.data]);
  const chainTemplates = useMemo(() => (chainsQ.data ? toChainTemplates(chainsQ.data) : []), [chainsQ.data]);
  const trajectory: Trajectory = state?.trajectory ?? "stable";
  const tierProgress = state?.tierProgress ?? 0;

  // Whenever a queued item leaves the outbox (sent or parked) the server state changed: refetch. Compared as a
  // set, so one item leaving while another arrives (same count) still refetches.
  const pendingCount = outboxSnap.pending.length;
  const prevPendingSet = useRef<readonly OutboxItem[]>([]);
  useEffect(() => {
    // Outbox items are logs: activity.
    if (pendingSetChanged(prevPendingSet.current, outboxSnap.pending)) void invalidateGame(queryClient, userId, { activity: true });
    if (outboxSnap.pending.length === 0) setSyncBlocked(false);
    prevPendingSet.current = outboxSnap.pending;
  }, [outboxSnap.pending, queryClient, userId]);

  // refetch functions are stable; depending on the whole query result would rebuild this every render.
  const refetchState = stateQ.refetch;
  const refetchLogs = logsQ.refetch;
  const refetchQuests = questsQ.refetch;
  const refetchChains = chainsQ.refetch;
  const refresh = useCallback(async () => {
    flushOutboxSoon();
    await Promise.all([refetchState(), refetchLogs(), refetchQuests(), refetchChains()]);
  }, [refetchState, refetchLogs, refetchQuests, refetchChains]);

  const addLog = useCallback(async (entry: LogInput) => {
    await enqueueLog(getOutbox(), entry);
    flushOutboxSoon();
  }, []);

  const runGuarded = useCallback(
    async <T,>(
      prefix: string,
      send: (clientId: string) => Promise<MutationResult<T>>,
      opts: { activity?: boolean } = {},
    ): Promise<GameMutationResult<T>> => {
      try {
        const r = await send(newClientId(prefix));
        if (!r.ok) {
          setSyncBlocked(true);
          return { ok: false, reason: "sync_pending" };
        }
        setSyncBlocked(false);
        return { ok: true, value: r.value };
      } catch (error) {
        return { ok: false, reason: "error", error };
      } finally {
        void invalidateGame(queryClient, userId, opts);
      }
    },
    [queryClient, userId],
  );

  const completeQuest = useCallback(
    (questId: string) =>
      runGuarded("quest-complete", (id) => completeQuestRequest(api, getOutbox(), questId, id), { activity: true }),
    [runGuarded],
  );
  const refuseQuest = useCallback(
    (questId: string, reason: string) =>
      runGuarded("quest-refuse", async (id) => {
        const r = await refuseQuestRequest(api, getOutbox(), questId, reason, id);
        return r.ok ? { ok: true as const, value: { floor: r.value.floor, shadowTook: r.value.shadowTook } } : r;
      }),
    [runGuarded],
  );
  const setQuestSlot = useCallback(
    (questId: string, slot: { slotStart: string; slotEnd: string } | null) =>
      runGuarded("quest-slot", (id) => setQuestSlotRequest(api, getOutbox(), questId, slot, id)),
    [runGuarded],
  );
  const setHomePath = useCallback(
    (active: boolean) =>
      runGuarded("home-path", async (id) => {
        const r = await setHomePathRequest(api, getOutbox(), active, id);
        return r.ok ? { ok: true as const, value: undefined } : r;
      }),
    [runGuarded],
  );
  const scheduleSeason = useCallback(
    (input: { kind: SeasonKind; startsOn: string; lengthDays: number }) =>
      runGuarded("season", async (id) => {
        const r = await scheduleSeasonRequest(api, getOutbox(), input, id);
        return r.ok ? { ok: true as const, value: undefined } : r;
      }),
    [runGuarded],
  );
  const cancelSeason = useCallback(
    (seasonId: string) =>
      runGuarded("season-cancel", async (id) => {
        const r = await cancelSeasonRequest(api, getOutbox(), seasonId, id);
        return r.ok ? { ok: true as const, value: undefined } : r;
      }),
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

  const value = useMemo<AppContextType>(
    () => ({
      user,
      domainScores,
      logs,
      quests,
      questChains,
      chainTemplates,
      shadowSelf,
      trajectory,
      tierProgress,
      achievements,
      milestones,
      loading: !state && !stateQ.isError,
      loadError: state ? null : stateQ.error,
      questsUpdatedAt: questsQ.dataUpdatedAt,
      questsLoadError: questsQ.data ? null : questsQ.error,
      refresh,
      getDomainScore,
      getWeakestDomain,
      getShadowScores,
      getShadowRank,
      getShadowPhase,
      addLog,
      completeQuest,
      refuseQuest,
      setQuestSlot,
      setHomePath,
      scheduleSeason,
      cancelSeason,
      startQuestChain,
      generateQuests,
      syncBlocked,
      offline: !online,
      pendingCount,
      failedCount: outboxSnap.failed.length,
      retryFailed,
      discardFailed,
    }),
    [
      user, domainScores, logs, quests, questChains, chainTemplates, shadowSelf, trajectory, tierProgress, achievements, milestones,
      state, stateQ.isError, stateQ.error, questsQ.data, questsQ.dataUpdatedAt, questsQ.error, refresh, getDomainScore, getWeakestDomain, getShadowScores, getShadowRank,
      getShadowPhase, addLog, completeQuest, refuseQuest, setQuestSlot, setHomePath, scheduleSeason, cancelSeason, startQuestChain, generateQuests, syncBlocked, online,
      pendingCount, outboxSnap.failed.length, retryFailed, discardFailed,
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
