// Network logic behind the gym screen. No React Native imports (used by the smoke script under plain node).
// The server owns every rule (points, PRs, plan days): this module only reads, sends and reshapes.
import {
  GymResponseSchema,
  PlanSchema,
  SessionCompleteResponseSchema,
  SessionSchema,
  SetSchema,
  type GymPlan,
  type GymSession,
} from "@workspace/contracts";
import { z } from "zod";
import { ApiError, type ApiClient } from "../api/client";
import type { Outbox } from "../api/outbox";
import { BODY_PARTS, WEEKDAYS } from "../../features/gym/model/constants";
import type {
  BodyPart,
  Exercise,
  PersonalRecord,
  Weekday,
  WorkoutBlock,
  WorkoutPlan,
  WorkoutSession,
  BodyPartScore,
} from "../../features/gym/model/types";
import { afterOutbox, type MutationResult } from "./actions";

export type GymData = z.infer<typeof GymResponseSchema>;
export type PlanBlock = GymPlan["days"][number]["blocks"][number];

// Notices are parsed one by one by lib/game/notices.ts; an unknown kind must not fail the completion.
const LooseCompleteSchema = SessionCompleteResponseSchema.extend({ notices: z.array(z.unknown()) });
export type GymCompletion = z.infer<typeof LooseCompleteSchema>;

export const MAX_PLAN_DAYS = 7;
export const MAX_BLOCKS_PER_DAY = 12;
const DEFAULT_REST_SEC = 90;

// --- calendar ---------------------------------------------------------------------

/** The weekday of the device's local calendar day. */
export function weekdayOf(date: Date): Weekday {
  return WEEKDAYS[date.getDay()] ?? "MON";
}

/** The planned blocks for that day of the plan; empty when the plan has no day for that weekday. */
export function planBlocksFor(
  plan: { days: { weekday: Weekday; blocks: PlanBlock[] }[] } | undefined,
  date: Date,
): PlanBlock[] {
  if (!plan) return [];
  const weekday = weekdayOf(date);
  return plan.days.find((d) => d.weekday === weekday)?.blocks ?? [];
}

// --- plan editor ------------------------------------------------------------------

export interface PlanDraftBlock {
  exerciseId: string;
  sets: number;
  reps: number;
}
export interface PlanDraftDay {
  weekday: Weekday;
  blocks: PlanDraftBlock[];
}
export interface PlanDraft {
  name: string;
  days: PlanDraftDay[];
}

/** One line in SYSTEM voice describing the first problem, or null when the draft can be saved. */
export function validatePlanDraft(draft: PlanDraft, exerciseIds: ReadonlySet<string>): string | null {
  if (!draft.name.trim()) return "Plan name required.";
  if (draft.name.trim().length > 80) return "Plan name is capped at 80 characters.";
  if (draft.days.length === 0) return "Add at least one training day.";
  if (draft.days.length > MAX_PLAN_DAYS) return `A plan holds at most ${MAX_PLAN_DAYS} days.`;
  if (new Set(draft.days.map((d) => d.weekday)).size !== draft.days.length) return "Each day may appear once.";
  if (!draft.days.some((d) => d.blocks.length > 0)) return "Add at least one exercise.";
  for (const day of draft.days) {
    if (day.blocks.length > MAX_BLOCKS_PER_DAY) return `${day.weekday}: at most ${MAX_BLOCKS_PER_DAY} exercises per day.`;
    for (const b of day.blocks) {
      if (!exerciseIds.has(b.exerciseId)) return `${day.weekday}: unknown exercise.`;
      if (!Number.isInteger(b.sets) || b.sets < 1 || b.sets > 20) return `${day.weekday}: sets must be 1 to 20.`;
      if (!Number.isInteger(b.reps) || b.reps < 1 || b.reps > 200) return `${day.weekday}: reps must be 1 to 200.`;
    }
  }
  return null;
}

export interface PlanRequest {
  name: string;
  goal: string;
  days: { weekday: Weekday; blocks: PlanBlock[] }[];
  clientId?: string;
}

/** The POST /api/gym/plans body. Days without exercises are left out. */
export function buildPlanRequest(draft: PlanDraft, clientId?: string): PlanRequest {
  return {
    name: draft.name.trim(),
    goal: "Custom split",
    days: draft.days
      .filter((d) => d.blocks.length > 0)
      .map((d) => ({
        weekday: d.weekday,
        blocks: d.blocks.map((b) => ({
          exerciseId: b.exerciseId,
          sets: b.sets,
          repRange: String(b.reps),
          restSec: DEFAULT_REST_SEC,
        })),
      })),
    ...(clientId ? { clientId } : {}),
  };
}

// --- reads and plan writes ----------------------------------------------------------

export function fetchGym(api: ApiClient): Promise<GymData> {
  return api.request("GET", "/api/gym", { schema: GymResponseSchema });
}

export function createPlan(api: ApiClient, req: PlanRequest): Promise<GymPlan> {
  return api.request("POST", "/api/gym/plans", { body: req, idempotencyKey: req.clientId, schema: PlanSchema });
}

export function activatePlan(api: ApiClient, planId: string, clientId: string): Promise<GymPlan> {
  return api.request("PATCH", `/api/gym/plans/${encodeURIComponent(planId)}`, {
    body: { isActive: true, clientId },
    idempotencyKey: clientId,
    schema: PlanSchema,
  });
}

// --- sessions -------------------------------------------------------------------------

const isNetwork = (e: unknown) => e instanceof ApiError && e.kind === "network";

/** A network failure means the server could not be reached: the action waits for a connection. */
async function offlineIsPending<T>(run: () => Promise<MutationResult<T>>): Promise<MutationResult<T>> {
  try {
    return await run();
  } catch (e) {
    if (isNetwork(e)) return { ok: false, reason: "sync_pending" };
    throw e;
  }
}

/** Creates the session online (the id is server-side). Queued logs flush first; offline is sync_pending. */
export function startGymSession(
  api: ApiClient,
  outbox: Pick<Outbox, "flushBeforeMutation">,
  clientId: string,
  planId?: string,
): Promise<MutationResult<GymSession>> {
  return offlineIsPending(() =>
    afterOutbox(outbox, () =>
      api.request("POST", "/api/gym/sessions", {
        body: { clientId, ...(planId ? { planId } : {}) },
        idempotencyKey: clientId,
        schema: SessionSchema,
      }),
    ),
  );
}

/** Completes the session (points, PRs, notices come back). Needs the outbox flushed and a connection. */
export function completeGymSession(
  api: ApiClient,
  outbox: Pick<Outbox, "flushBeforeMutation">,
  sessionId: string,
  clientId: string,
): Promise<MutationResult<GymCompletion>> {
  return offlineIsPending(() =>
    afterOutbox(outbox, () =>
      api.request("POST", `/api/gym/sessions/${encodeURIComponent(sessionId)}/complete`, {
        body: { clientId },
        idempotencyKey: clientId,
        schema: LooseCompleteSchema,
      }),
    ),
  );
}

// --- sets (sent directly, retried) ---------------------------------------------------------

export interface SetPayload {
  exerciseId: string;
  reps: number;
  weight: number;
  completed: boolean;
  setIndex: number;
}
export interface QueuedSet {
  /** Stable per set: sent as the clientId and the Idempotency-Key, so a replay never doubles the set. */
  key: string;
  sessionId: string;
  set: SetPayload;
}

export function newSetKey(sessionId: string): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `gym-set-${sessionId.slice(0, 8)}-${Date.now().toString(36)}-${rand()}`;
}

/**
 * Sends the queued sets in order. A network error or 5xx stops the flush and keeps that set and the rest for a
 * later pass. Any other failure (e.g. the session is already completed, or the set is invalid) can never
 * succeed, so the set is dropped and reported.
 */
export async function flushSetQueue(
  api: ApiClient,
  queue: readonly QueuedSet[],
): Promise<{ remaining: QueuedSet[]; dropped: QueuedSet[] }> {
  const dropped: QueuedSet[] = [];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    try {
      await api.request("POST", `/api/gym/sessions/${encodeURIComponent(item.sessionId)}/sets`, {
        body: { ...item.set, clientId: item.key },
        idempotencyKey: item.key,
        schema: SetSchema,
      });
    } catch (e) {
      const retryable = !(e instanceof ApiError) || e.kind === "network" || (e.kind === "http" && (e.status ?? 0) >= 500);
      if (retryable) return { remaining: queue.slice(i), dropped };
      dropped.push(item);
    }
  }
  return { remaining: [], dropped };
}

// --- server data -> screen model --------------------------------------------------------------

export interface GymView {
  exercises: Exercise[];
  workoutPlans: WorkoutPlan[];
  activePlanId: string | null;
  workoutSessions: WorkoutSession[];
  personalRecords: PersonalRecord[];
  bodyPartScores: BodyPartScore[];
}

const asBodyPart = (s: string) => s as BodyPart;

export function toWorkoutSession(s: GymSession): WorkoutSession {
  return {
    id: s.id,
    date: s.startedAt,
    planId: s.planId ?? undefined,
    completedAt: s.completedAt ?? undefined,
    points: s.points,
    performed: [],
  };
}

export function toGymView(data: GymData): GymView {
  const plans = [...data.plans].sort((a, b) => Number(b.isActive) - Number(a.isActive));
  const scores = new Map(data.bodyPartScores.map((s) => [s.bodyPart, s]));
  return {
    exercises: data.exercises.map((e) => ({
      id: e.id,
      name: e.name,
      primaryBodyPart: asBodyPart(e.primaryBodyPart),
      secondaryBodyParts: e.secondaryBodyParts.map(asBodyPart),
      isBig5: e.isBig5,
    })),
    workoutPlans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      goal: p.goal,
      days: p.days.map((d) => ({
        id: `${p.id}-${d.weekday}`,
        planId: p.id,
        weekday: d.weekday,
        blocks: d.blocks.map((b): WorkoutBlock => ({ ...b })),
      })),
    })),
    activePlanId: data.activePlanId,
    workoutSessions: data.recentSessions.map(toWorkoutSession),
    personalRecords: data.personalRecords.map((r) => ({ ...r, metricType: "weight_1rm_proxy" as const })),
    bodyPartScores: BODY_PARTS.map((bodyPart) => {
      const s = scores.get(bodyPart);
      return { bodyPart, pointsTotal: s?.points ?? 0, lastUpdatedAt: s?.updatedAt ?? "" };
    }),
  };
}
