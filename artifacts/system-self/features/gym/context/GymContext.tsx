import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useApp } from "@/context/AppContext";
import { BODY_PARTS, DEFAULT_EXERCISES, WEEKDAYS } from "@/features/gym/model/constants";
import type {
  BodyPartScore,
  Exercise,
  NewPrEvent,
  PerformedSet,
  PersonalRecord,
  WorkoutBlock,
  WorkoutPlan,
  WorkoutSession,
} from "@/features/gym/model/types";
import { computeGymPoints, mergeBodyPartScores } from "@/features/gym/services/gymScoringService";
import { getPlanDayForDate } from "@/features/gym/services/planService";
import { computePrUpdates } from "@/features/gym/services/prService";

interface GymState {
  exercises: Exercise[];
  workoutPlans: WorkoutPlan[];
  workoutSessions: WorkoutSession[];
  personalRecords: PersonalRecord[];
  bodyPartScores: BodyPartScore[];
  lastPrEvents: NewPrEvent[];
  loading: boolean;
}

interface GymContextType extends GymState {
  createWorkoutPlan: (planInput: Omit<WorkoutPlan, "id">) => Promise<WorkoutPlan>;
  updateWorkoutPlan: (planId: string, patch: Partial<WorkoutPlan>) => Promise<void>;
  startWorkoutSession: (planId?: string) => Promise<WorkoutSession>;
  logPerformedSet: (sessionId: string, setPayload: Omit<PerformedSet, "setIndex"> & { setIndex?: number }) => Promise<void>;
  completeWorkoutSession: (sessionId: string) => Promise<void>;
  getBodyPartScores: () => BodyPartScore[];
  getPersonalRecords: (exerciseIds?: string[]) => PersonalRecord[];
}

const STORAGE_KEYS = {
  EXERCISES: "@system_self:gym:exercises",
  PLANS: "@system_self:gym:plans",
  SESSIONS: "@system_self:gym:sessions",
  PRS: "@system_self:gym:prs",
  BODY_PART_SCORES: "@system_self:gym:body_part_scores",
} as const;

const GymContext = createContext<GymContextType | null>(null);

function id(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 8);
}

function defaultBodyPartScores(): BodyPartScore[] {
  const now = new Date().toISOString();
  return BODY_PARTS.map((bodyPart) => ({ bodyPart, pointsTotal: 0, lastUpdatedAt: now }));
}

function defaultPlan(): WorkoutPlan {
  const makeDay = (weekday: (typeof WEEKDAYS)[number], blocks: WorkoutBlock[]) => ({
    id: id(),
    planId: "",
    weekday,
    blocks,
  });
  const planId = id();
  const plan: WorkoutPlan = {
    id: planId,
    name: "Starter Strength",
    goal: "Consistency and progressive overload",
    days: [
      makeDay("MON", [
        { exerciseId: "ex_squat", sets: 3, repRange: "5-8", restSec: 120 },
        { exerciseId: "ex_bench", sets: 3, repRange: "5-8", restSec: 120 },
        { exerciseId: "ex_row", sets: 3, repRange: "6-10", restSec: 90 },
      ]),
      makeDay("WED", [
        { exerciseId: "ex_deadlift", sets: 3, repRange: "3-6", restSec: 150 },
        { exerciseId: "ex_ohp", sets: 3, repRange: "5-8", restSec: 120 },
        { exerciseId: "ex_pullup", sets: 3, repRange: "6-10", restSec: 90 },
      ]),
      makeDay("FRI", [
        { exerciseId: "ex_squat", sets: 3, repRange: "5-8", restSec: 120 },
        { exerciseId: "ex_bench", sets: 3, repRange: "5-8", restSec: 120 },
        { exerciseId: "ex_plank", sets: 3, repRange: "30-60s", restSec: 60 },
      ]),
    ],
  };
  plan.days = plan.days.map((d) => ({ ...d, planId }));
  return plan;
}

export function GymProvider({ children }: { children: React.ReactNode }) {
  const { updateDomainScore } = useApp();
  const [state, setState] = useState<GymState>({
    exercises: DEFAULT_EXERCISES,
    workoutPlans: [],
    workoutSessions: [],
    personalRecords: [],
    bodyPartScores: defaultBodyPartScores(),
    lastPrEvents: [],
    loading: true,
  });

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    const [ex, plans, sessions, prs, bodyPartScores] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.EXERCISES),
      AsyncStorage.getItem(STORAGE_KEYS.PLANS),
      AsyncStorage.getItem(STORAGE_KEYS.SESSIONS),
      AsyncStorage.getItem(STORAGE_KEYS.PRS),
      AsyncStorage.getItem(STORAGE_KEYS.BODY_PART_SCORES),
    ]);

    const parsedPlans = plans ? (JSON.parse(plans) as WorkoutPlan[]) : [defaultPlan()];
    if (!plans) {
      await AsyncStorage.setItem(STORAGE_KEYS.PLANS, JSON.stringify(parsedPlans));
    }

    setState({
      exercises: ex ? (JSON.parse(ex) as Exercise[]) : DEFAULT_EXERCISES,
      workoutPlans: parsedPlans,
      workoutSessions: sessions ? (JSON.parse(sessions) as WorkoutSession[]) : [],
      personalRecords: prs ? (JSON.parse(prs) as PersonalRecord[]) : [],
      bodyPartScores: bodyPartScores ? (JSON.parse(bodyPartScores) as BodyPartScore[]) : defaultBodyPartScores(),
      lastPrEvents: [],
      loading: false,
    });
  };

  const persist = useCallback(async (next: Partial<GymState>) => {
    await Promise.all([
      next.exercises ? AsyncStorage.setItem(STORAGE_KEYS.EXERCISES, JSON.stringify(next.exercises)) : Promise.resolve(),
      next.workoutPlans ? AsyncStorage.setItem(STORAGE_KEYS.PLANS, JSON.stringify(next.workoutPlans)) : Promise.resolve(),
      next.workoutSessions ? AsyncStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(next.workoutSessions)) : Promise.resolve(),
      next.personalRecords ? AsyncStorage.setItem(STORAGE_KEYS.PRS, JSON.stringify(next.personalRecords)) : Promise.resolve(),
      next.bodyPartScores ? AsyncStorage.setItem(STORAGE_KEYS.BODY_PART_SCORES, JSON.stringify(next.bodyPartScores)) : Promise.resolve(),
    ]);
  }, []);

  const createWorkoutPlan = useCallback(async (planInput: Omit<WorkoutPlan, "id">) => {
    const next: WorkoutPlan = { ...planInput, id: id() };
    next.days = next.days.map((d) => ({ ...d, id: d.id || id(), planId: next.id }));
    setState((prev) => {
      const workoutPlans = [...prev.workoutPlans, next];
      void persist({ workoutPlans });
      return { ...prev, workoutPlans };
    });
    return next;
  }, [persist]);

  const updateWorkoutPlan = useCallback(async (planId: string, patch: Partial<WorkoutPlan>) => {
    setState((prev) => {
      const workoutPlans = prev.workoutPlans.map((p) => (p.id === planId ? { ...p, ...patch, id: p.id } : p));
      void persist({ workoutPlans });
      return { ...prev, workoutPlans };
    });
  }, [persist]);

  const startWorkoutSession = useCallback(async (planId?: string) => {
    const session: WorkoutSession = {
      id: id(),
      date: new Date().toISOString(),
      planId,
      performed: [],
    };
    setState((prev) => {
      const workoutSessions = [...prev.workoutSessions, session];
      void persist({ workoutSessions });
      return { ...prev, workoutSessions };
    });
    return session;
  }, [persist]);

  const logPerformedSet = useCallback(async (sessionId: string, setPayload: Omit<PerformedSet, "setIndex"> & { setIndex?: number }) => {
    setState((prev) => {
      const workoutSessions = prev.workoutSessions.map((s) => {
        if (s.id !== sessionId) return s;
        const countForExercise = s.performed.filter((x) => x.exerciseId === setPayload.exerciseId).length;
        const nextSet: PerformedSet = {
          ...setPayload,
          setIndex: setPayload.setIndex ?? countForExercise + 1,
        };
        return { ...s, performed: [...s.performed, nextSet] };
      });
      void persist({ workoutSessions });
      return { ...prev, workoutSessions };
    });
  }, [persist]);

  const completeWorkoutSession = useCallback(async (sessionId: string) => {
    const now = new Date().toISOString();
    const session = state.workoutSessions.find((s) => s.id === sessionId);
    if (!session) return;
    if (session.completedAt) return;

    const completedSession: WorkoutSession = { ...session, completedAt: now };
    const workoutSessions = state.workoutSessions.map((s) => (s.id === sessionId ? completedSession : s));

    const plan = state.workoutPlans.find((p) => p.id === session.planId) ?? state.workoutPlans[0];
    const plannedBlocks = getPlanDayForDate(plan, completedSession.date)?.blocks ?? [];
    const exercisesById = Object.fromEntries(state.exercises.map((x) => [x.id, x]));

    const points = computeGymPoints(completedSession, plannedBlocks, exercisesById);
    const bodyPartScores = mergeBodyPartScores(state.bodyPartScores, points.bodyPartPoints, now);

    if (points.totalPoints > 0) {
      await updateDomainScore("BODY", points.totalPoints, false);
    }

    const prRes = computePrUpdates(completedSession, exercisesById, state.personalRecords);

    setState((prev) => ({
      ...prev,
      workoutSessions,
      bodyPartScores,
      personalRecords: prRes.updatedRecords,
      lastPrEvents: prRes.newPrEvents,
    }));
    await persist({
      workoutSessions,
      bodyPartScores,
      personalRecords: prRes.updatedRecords,
    });
  }, [persist, state.bodyPartScores, state.exercises, state.personalRecords, state.workoutPlans, state.workoutSessions, updateDomainScore]);

  const getBodyPartScores = useCallback(() => state.bodyPartScores, [state.bodyPartScores]);

  const getPersonalRecords = useCallback((exerciseIds?: string[]) => {
    if (!exerciseIds || exerciseIds.length === 0) return state.personalRecords;
    const set = new Set(exerciseIds);
    return state.personalRecords.filter((pr) => set.has(pr.exerciseId));
  }, [state.personalRecords]);

  const value = useMemo<GymContextType>(() => ({
    ...state,
    createWorkoutPlan,
    updateWorkoutPlan,
    startWorkoutSession,
    logPerformedSet,
    completeWorkoutSession,
    getBodyPartScores,
    getPersonalRecords,
  }), [completeWorkoutSession, createWorkoutPlan, getBodyPartScores, getPersonalRecords, logPerformedSet, startWorkoutSession, state, updateWorkoutPlan]);

  return <GymContext.Provider value={value}>{children}</GymContext.Provider>;
}

export function useGym() {
  const ctx = useContext(GymContext);
  if (!ctx) throw new Error("useGym must be used within GymProvider");
  return ctx;
}

