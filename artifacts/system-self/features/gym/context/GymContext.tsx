// Gym state for the screens, backed by /api/gym. The server computes points and PRs (POST .../complete);
// this provider reads the data through React Query (cached for offline), creates sessions online, sends sets
// with a stable idempotency key and retries them, and completes sessions once every set has landed.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useGameUserId } from "@/hooks/useGameState";
import { api, ApiError } from "@/lib/api/client";
import { getOutbox } from "@/lib/api/outbox";
import { useOnline } from "@/lib/api/query";
import { newClientId } from "@/lib/game/actions";
import {
  activatePlan,
  applyFlushResult,
  buildPlanRequest,
  completeGymSession,
  createPlan,
  createPlanClientIds,
  emptyActive,
  fetchGym,
  flushSetQueue,
  loadActive,
  saveActive,
  newSetKey,
  startGymSession,
  toGymView,
  toWorkoutPlan,
  toWorkoutSession,
  validatePlanDraft,
  type ActiveRecord,
  type GymCompletion,
  type PlanDraft,
  type QueuedSet,
} from "@/lib/game/gym";
import { gymKey, invalidateGame } from "@/lib/game/keys";
import type {
  BodyPartScore,
  Exercise,
  NewPrEvent,
  PerformedSet,
  PersonalRecord,
  WorkoutPlan,
  WorkoutSession,
} from "@/features/gym/model/types";

export type GymActionResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; reason: "sync_pending" | "invalid" | "already_completed" | "error"; message?: string; error?: unknown };

interface GymContextType {
  exercises: Exercise[];
  workoutPlans: WorkoutPlan[];
  activePlanId: string | null;
  workoutSessions: WorkoutSession[];
  personalRecords: PersonalRecord[];
  bodyPartScores: BodyPartScore[];
  lastPrEvents: NewPrEvent[];
  /** The most recent completion (points, per body part), for the result line. */
  lastCompletion: GymCompletion | null;
  /** Sets logged on this device that the server has not confirmed yet. */
  unsyncedSets: number;
  /** Sets the server refused for good since the last dismissal. */
  rejectedSets: number;
  dismissRejectedSets: () => void;
  /** The in-progress session (started or restored from the last run), if any. */
  activeSessionId: string | null;
  /** True when the active session was restored from storage and not touched since. */
  restoredSession: boolean;
  /** True until the saved session of the signed-in user has been loaded: nothing may start a session before. */
  restoring: boolean;
  /** Sends the unsent sets now and waits until the result is saved (sign-out checks what is left). */
  flushPendingSets: () => Promise<void>;
  /** Drops the local session and its unsent sets (the server session stays incomplete). */
  discardActiveSession: () => Promise<void>;
  loading: boolean;
  /** True when the first load failed and there is no cached data. */
  loadFailed: boolean;
  refresh: () => Promise<void>;
  createWorkoutPlan: (draft: PlanDraft) => Promise<GymActionResult<WorkoutPlan | null>>;
  updateWorkoutPlan: (planId: string, patch: { isActive: true }) => Promise<GymActionResult>;
  startWorkoutSession: (planId?: string) => Promise<GymActionResult<WorkoutSession>>;
  logPerformedSet: (
    sessionId: string,
    setPayload: Omit<PerformedSet, "setIndex"> & { setIndex?: number },
  ) => Promise<void>;
  completeWorkoutSession: (sessionId: string) => Promise<GymActionResult<GymCompletion>>;
  getBodyPartScores: () => BodyPartScore[];
  getPersonalRecords: (exerciseIds?: string[]) => PersonalRecord[];
}

const GymContext = createContext<GymContextType | null>(null);

const EMPTY_VIEW = toGymView({
  exercises: [],
  plans: [],
  activePlanId: null,
  recentSessions: [],
  personalRecords: [],
  bodyPartScores: [],
});

export function GymProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const userId = useGameUserId();
  const online = useOnline();
  const q = useQuery({ queryKey: gymKey(userId), queryFn: () => fetchGym(api), enabled: !!userId });
  const refetch = q.refetch;

  // Sessions started on this device, with the sets logged so far (the server list has no sets).
  const [localSessions, setLocalSessionsState] = useState<Record<string, WorkoutSession>>({});
  // A synchronous mirror: logging a set reads the session it extends, so it cannot wait for a render.
  const sessionsRef = useRef<Record<string, WorkoutSession>>({});
  const setLocalSessions = useCallback((update: (prev: Record<string, WorkoutSession>) => Record<string, WorkoutSession>) => {
    sessionsRef.current = update(sessionsRef.current);
    setLocalSessionsState(sessionsRef.current);
  }, []);
  const [lastPrEvents, setLastPrEvents] = useState<NewPrEvent[]>([]);
  const [lastCompletion, setLastCompletion] = useState<GymCompletion | null>(null);
  const [unsyncedSets, setUnsyncedSets] = useState(0);
  const [rejectedSets, setRejectedSets] = useState(0);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const [restoredSession, setRestoredSession] = useState(false);
  // The user id whose saved session has been loaded (state twin of restoredFor, for rendering).
  const [restoredUser, setRestoredUser] = useState<string | null>(null);
  const planIds = useRef(createPlanClientIds(() => newClientId("gym-plan")));
  const activeIdRef = useRef<string | null>(null);
  const pendingStart = useRef<ActiveRecord["pendingStart"]>(null);
  const restoredFor = useRef<string | null>(null);
  const writing = useRef<Promise<void>>(Promise.resolve());
  const queue = useRef<QueuedSet[]>([]);
  const sending = useRef<Promise<void> | null>(null);
  const busy = useRef(new Set<string>());

  const setActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveSessionIdState(id);
  }, []);

  /** Writes the in-progress session, unsent sets and pending start id for this user (writes are serialized). */
  const persist = useCallback(() => {
    if (!userId || restoredFor.current !== userId) return;
    const id = activeIdRef.current;
    const s = id ? sessionsRef.current[id] : undefined;
    const rec: ActiveRecord = {
      session: s && !s.completedAt ? { id: s.id, planId: s.planId ?? null, startedAt: s.date, performed: s.performed } : null,
      queue: queue.current,
      pendingStart: pendingStart.current,
    };
    writing.current = writing.current.then(() => saveActive(AsyncStorage, userId, rec)).catch(() => undefined);
  }, [userId]);

  // A different account starts clean; the signed-in account gets its unfinished session back.
  useEffect(() => {
    restoredFor.current = null;
    setLocalSessions(() => ({}));
    setLastPrEvents([]);
    setLastCompletion(null);
    setRejectedSets(0);
    setRestoredSession(false);
    setRestoredUser(null);
    setActiveId(null);
    pendingStart.current = null;
    queue.current = [];
    planIds.current = createPlanClientIds(() => newClientId("gym-plan"));
    setUnsyncedSets(0);
    if (!userId) return;
    let cancelled = false;
    void loadActive(AsyncStorage, userId).then((rec) => {
      if (cancelled) return;
      queue.current = [...rec.queue, ...queue.current];
      setUnsyncedSets(queue.current.length);
      pendingStart.current = rec.pendingStart;
      if (rec.session) {
        const r = rec.session;
        setLocalSessions(() => ({
          [r.id]: { id: r.id, date: r.startedAt, planId: r.planId ?? undefined, points: 0, performed: r.performed },
        }));
        setActiveId(r.id);
        setRestoredSession(true);
      }
      restoredFor.current = userId;
      setRestoredUser(userId);
      if (rec.queue.length > 0) void flushSetsRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, [userId, setLocalSessions, setActiveId]);

  const flushSetsRef = useRef<() => Promise<boolean>>(async () => true);
  const flushSets = useCallback(async (): Promise<boolean> => {
    // Serialize passes so one set is never in flight twice.
    while (sending.current) await sending.current;
    if (queue.current.length === 0) return true;
    const pass = (async () => {
      const r = await flushSetQueue(api, queue.current);
      // Only processed sets leave the queue: one logged while this pass was in flight stays for the next.
      queue.current = applyFlushResult(queue.current, r);
      setUnsyncedSets(queue.current.length);
      if (r.dropped.length > 0) {
        console.warn(`gym: ${r.dropped.length} set(s) rejected by the server`, r.dropped.map((d) => d.key));
        setRejectedSets((n) => n + r.dropped.length);
      }
      persist();
    })();
    sending.current = pass;
    try {
      await pass;
    } finally {
      sending.current = null;
    }
    return queue.current.length === 0;
  }, [persist]);
  flushSetsRef.current = flushSets;

  useEffect(() => {
    if (online && userId) void flushSets();
  }, [online, userId, flushSets]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void flushSets();
    });
    return () => sub.remove();
  }, [flushSets]);

  const view = useMemo(() => (q.data ? toGymView(q.data) : EMPTY_VIEW), [q.data]);

  const workoutSessions = useMemo(() => {
    const server = view.workoutSessions.map((s) => localSessions[s.id] ?? s);
    const known = new Set(server.map((s) => s.id));
    const fresh = Object.values(localSessions).filter((s) => !known.has(s.id));
    return [...server, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
  }, [view.workoutSessions, localSessions]);

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const guarded = useCallback(
    async <T,>(key: string, run: () => Promise<GymActionResult<T>>): Promise<GymActionResult<T>> => {
      if (busy.current.has(key)) return { ok: false, reason: "error", message: "Already in progress." };
      busy.current.add(key);
      try {
        return await run();
      } catch (error) {
        return { ok: false, reason: "error", error };
      } finally {
        busy.current.delete(key);
      }
    },
    [],
  );

  const createWorkoutPlan = useCallback(
    (draft: PlanDraft) =>
      guarded("plan", async () => {
        const known = new Set(view.exercises.map((e) => e.id));
        const problem = validatePlanDraft(draft, known);
        if (problem) return { ok: false, reason: "invalid", message: problem };
        // The same draft keeps its clientId until a save succeeds, so a retry after a lost response is deduped.
        const plan = await createPlan(api, buildPlanRequest(draft, planIds.current.idFor(draft)));
        planIds.current.succeeded();
        await queryClient.invalidateQueries({ queryKey: gymKey(userId) });
        return { ok: true, value: toWorkoutPlan(plan) };
      }),
    [guarded, view.exercises, queryClient, userId],
  );

  const updateWorkoutPlan = useCallback(
    (planId: string, patch: { isActive: true }) =>
      guarded("plan", async () => {
        if (patch.isActive) await activatePlan(api, planId, newClientId("gym-activate"));
        await queryClient.invalidateQueries({ queryKey: gymKey(userId) });
        return { ok: true, value: undefined };
      }),
    [guarded, queryClient, userId],
  );

  const startWorkoutSession = useCallback(
    (planId?: string) =>
      guarded("start", async () => {
        // Starting before the saved session is restored could overwrite it (and its pending start id).
        if (!userId || restoredFor.current !== userId) return { ok: false, reason: "error", message: "Restoring." };
        // One clientId per pending start (kept in storage): a retry after a lost response is deduped by the server.
        const pending = pendingStart.current;
        const start = pending && pending.planId === planId ? pending : { clientId: newClientId("gym-session"), planId };
        pendingStart.current = start;
        persist();
        const r = await startGymSession(api, getOutbox(), start.clientId, planId);
        if (!r.ok) return { ok: false, reason: "sync_pending" };
        pendingStart.current = null;
        const session = toWorkoutSession(r.value);
        setLocalSessions((prev) => ({ ...prev, [session.id]: session }));
        setActiveId(session.id);
        setRestoredSession(false);
        persist();
        return { ok: true, value: session };
      }),
    [guarded, setLocalSessions, setActiveId, persist, userId],
  );

  const logPerformedSet = useCallback(
    async (sessionId: string, setPayload: Omit<PerformedSet, "setIndex"> & { setIndex?: number }) => {
      const s = sessionsRef.current[sessionId];
      if (!s || s.completedAt) return;
      const setIndex = setPayload.setIndex ?? s.performed.filter((x) => x.exerciseId === setPayload.exerciseId).length;
      const set: PerformedSet = { ...setPayload, setIndex };
      setLocalSessions((prev) => ({ ...prev, [sessionId]: { ...s, performed: [...s.performed, set] } }));
      const queued: QueuedSet = {
        key: newSetKey(sessionId),
        sessionId,
        set: { exerciseId: set.exerciseId, reps: set.reps, weight: set.weight, completed: set.completed, setIndex },
      };
      queue.current = [...queue.current, queued];
      setUnsyncedSets(queue.current.length);
      setRestoredSession(false);
      persist();
      await flushSets();
    },
    [flushSets, setLocalSessions, persist],
  );

  const completeWorkoutSession = useCallback(
    (sessionId: string) =>
      guarded(`complete-${sessionId}`, async () => {
        // Points count the sets the server has: all of this session's sets must land first.
        await flushSets();
        if (queue.current.some((s) => s.sessionId === sessionId)) return { ok: false, reason: "sync_pending" };
        try {
          const r = await completeGymSession(api, getOutbox(), sessionId, `gym-done-${sessionId}`);
          if (!r.ok) return { ok: false, reason: "sync_pending" };
          const done = r.value;
          setLastCompletion(done);
          setLastPrEvents(
            done.newPrs.map((p) => ({ exerciseId: p.exerciseId, exerciseName: p.name, value: p.value, achievedAt: p.achievedAt })),
          );
          setLocalSessions((prev) => {
            const s = prev[sessionId];
            return s ? { ...prev, [sessionId]: { ...s, completedAt: done.session.completedAt ?? new Date().toISOString(), points: done.points } } : prev;
          });
          if (activeIdRef.current === sessionId) setActiveId(null);
          return { ok: true, value: done };
        } catch (error) {
          if (error instanceof ApiError && error.code === "already_completed") {
            setLocalSessions((prev) => {
              const s = prev[sessionId];
              return s ? { ...prev, [sessionId]: { ...s, completedAt: s.completedAt ?? new Date().toISOString() } } : prev;
            });
            if (activeIdRef.current === sessionId) setActiveId(null);
            return { ok: false, reason: "already_completed" };
          }
          throw error;
        } finally {
          persist();
          // Points, notices and scores changed on the server.
          void queryClient.invalidateQueries({ queryKey: gymKey(userId) });
          void invalidateGame(queryClient, userId);
        }
      }),
    [guarded, flushSets, queryClient, userId, setLocalSessions, setActiveId, persist],
  );

  const discardActiveSession = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    queue.current = queue.current.filter((s) => s.sessionId !== id);
    setUnsyncedSets(queue.current.length);
    setLocalSessions((prev) => {
      const { [id]: _gone, ...rest } = prev;
      return rest;
    });
    setActiveId(null);
    setRestoredSession(false);
    persist();
    await writing.current;
  }, [setLocalSessions, setActiveId, persist]);

  const dismissRejectedSets = useCallback(() => setRejectedSets(0), []);

  const flushPendingSets = useCallback(async () => {
    await flushSets();
    await writing.current;
  }, [flushSets]);

  const restoring = !!userId && restoredUser !== userId;

  const getBodyPartScores = useCallback(() => view.bodyPartScores, [view.bodyPartScores]);

  const getPersonalRecords = useCallback(
    (exerciseIds?: string[]) => {
      if (!exerciseIds || exerciseIds.length === 0) return view.personalRecords;
      const set = new Set(exerciseIds);
      return view.personalRecords.filter((pr) => set.has(pr.exerciseId));
    },
    [view.personalRecords],
  );

  const value = useMemo<GymContextType>(
    () => ({
      exercises: view.exercises,
      workoutPlans: view.workoutPlans,
      activePlanId: view.activePlanId,
      workoutSessions,
      personalRecords: view.personalRecords,
      bodyPartScores: view.bodyPartScores,
      lastPrEvents,
      lastCompletion,
      unsyncedSets,
      rejectedSets,
      dismissRejectedSets,
      activeSessionId,
      restoredSession,
      restoring,
      flushPendingSets,
      discardActiveSession,
      loading: !!userId && q.isPending,
      loadFailed: q.isError && !q.data,
      refresh,
      createWorkoutPlan,
      updateWorkoutPlan,
      startWorkoutSession,
      logPerformedSet,
      completeWorkoutSession,
      getBodyPartScores,
      getPersonalRecords,
    }),
    [
      view, workoutSessions, lastPrEvents, lastCompletion, unsyncedSets, rejectedSets, dismissRejectedSets, activeSessionId, restoredSession, restoring, flushPendingSets, discardActiveSession, userId, q.isPending, q.isError, q.data, refresh,
      createWorkoutPlan, updateWorkoutPlan, startWorkoutSession, logPerformedSet, completeWorkoutSession,
      getBodyPartScores, getPersonalRecords,
    ],
  );

  return <GymContext.Provider value={value}>{children}</GymContext.Provider>;
}

export function useGym() {
  const ctx = useContext(GymContext);
  if (!ctx) throw new Error("useGym must be used within GymProvider");
  return ctx;
}
