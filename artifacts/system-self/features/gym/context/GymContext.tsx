// Gym state for the screens, backed by /api/gym. The server computes points and PRs (POST .../complete);
// this provider reads the data through React Query (cached for offline), creates sessions online, sends sets
// with a stable idempotency key and retries them, and completes sessions once every set has landed.
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
  buildPlanRequest,
  completeGymSession,
  createPlan,
  fetchGym,
  flushSetQueue,
  newSetKey,
  startGymSession,
  toGymView,
  toWorkoutSession,
  validatePlanDraft,
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
  const queue = useRef<QueuedSet[]>([]);
  const sending = useRef<Promise<void> | null>(null);
  const busy = useRef(new Set<string>());

  // A different account starts clean.
  useEffect(() => {
    setLocalSessions(() => ({}));
    setLastPrEvents([]);
    setLastCompletion(null);
    queue.current = [];
    setUnsyncedSets(0);
  }, [userId]);

  const flushSets = useCallback(async (): Promise<boolean> => {
    // Serialize passes so one set is never in flight twice.
    while (sending.current) await sending.current;
    if (queue.current.length === 0) return true;
    const pass = (async () => {
      const r = await flushSetQueue(api, queue.current);
      queue.current = r.remaining;
      setUnsyncedSets(r.remaining.length);
    })();
    sending.current = pass;
    try {
      await pass;
    } finally {
      sending.current = null;
    }
    return queue.current.length === 0;
  }, []);

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
        const plan = await createPlan(api, buildPlanRequest(draft, newClientId("gym-plan")));
        await queryClient.invalidateQueries({ queryKey: gymKey(userId) });
        return { ok: true, value: view.workoutPlans.find((p) => p.id === plan.id) ?? null };
      }),
    [guarded, view.exercises, view.workoutPlans, queryClient, userId],
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
        const r = await startGymSession(api, getOutbox(), newClientId("gym-session"), planId);
        if (!r.ok) return { ok: false, reason: "sync_pending" };
        const session = toWorkoutSession(r.value);
        setLocalSessions((prev) => ({ ...prev, [session.id]: session }));
        return { ok: true, value: session };
      }),
    [guarded, setLocalSessions],
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
      await flushSets();
    },
    [flushSets, setLocalSessions],
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
          return { ok: true, value: done };
        } catch (error) {
          if (error instanceof ApiError && error.code === "already_completed") {
            setLocalSessions((prev) => {
              const s = prev[sessionId];
              return s ? { ...prev, [sessionId]: { ...s, completedAt: s.completedAt ?? new Date().toISOString() } } : prev;
            });
            return { ok: false, reason: "already_completed" };
          }
          throw error;
        } finally {
          // Points, notices and scores changed on the server.
          void queryClient.invalidateQueries({ queryKey: gymKey(userId) });
          void invalidateGame(queryClient, userId);
        }
      }),
    [guarded, flushSets, queryClient, userId, setLocalSessions],
  );

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
      view, workoutSessions, lastPrEvents, lastCompletion, unsyncedSets, userId, q.isPending, q.isError, q.data, refresh,
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
