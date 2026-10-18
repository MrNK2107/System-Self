export type BodyPart =
  | "chest"
  | "back"
  | "quads"
  | "hamstrings"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "core"
  | "glutes"
  | "calves";

export type Weekday = "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";

export const BODY_PARTS: BodyPart[] = [
  "chest", "back", "quads", "hamstrings", "shoulders", "biceps", "triceps", "core", "glutes", "calves",
];

export const WEEKDAYS: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const BASE_POINTS_PER_COMPLETED_SET = 1.2;
export const BLOCK_COMPLETION_BONUS = 1.5;
export const SESSION_COMPLETION_BONUS = 2.0;

export interface ExerciseDef {
  id: string;
  name: string;
  primaryBodyPart: BodyPart;
  secondaryBodyParts: BodyPart[];
  isBig5: boolean;
}

export interface PlanBlockDef {
  exerciseId: string;
  sets: number;
  repRange: string;
  restSec: number;
}

export interface PlanDef {
  name: string;
  goal: string;
  days: { weekday: Weekday; blocks: PlanBlockDef[] }[];
}

export const BIG5_EXERCISE_NAMES = ["Back Squat", "Bench Press", "Deadlift", "Overhead Press", "Barbell Row"] as const;

export const DEFAULT_EXERCISES: ExerciseDef[] = [
  { id: "ex_squat", name: "Back Squat", primaryBodyPart: "quads", secondaryBodyParts: ["glutes", "core"], isBig5: true },
  { id: "ex_bench", name: "Bench Press", primaryBodyPart: "chest", secondaryBodyParts: ["triceps", "shoulders"], isBig5: true },
  { id: "ex_deadlift", name: "Deadlift", primaryBodyPart: "hamstrings", secondaryBodyParts: ["back", "glutes"], isBig5: true },
  { id: "ex_ohp", name: "Overhead Press", primaryBodyPart: "shoulders", secondaryBodyParts: ["triceps", "core"], isBig5: true },
  { id: "ex_row", name: "Barbell Row", primaryBodyPart: "back", secondaryBodyParts: ["biceps", "core"], isBig5: true },
  { id: "ex_pullup", name: "Pull-up", primaryBodyPart: "back", secondaryBodyParts: ["biceps"], isBig5: false },
  { id: "ex_lunge", name: "Walking Lunge", primaryBodyPart: "quads", secondaryBodyParts: ["glutes"], isBig5: false },
  { id: "ex_plank", name: "Plank", primaryBodyPart: "core", secondaryBodyParts: [], isBig5: false },
];

export const DEFAULT_PLAN: PlanDef = {
  name: "Starter Strength",
  goal: "Consistency and progressive overload",
  days: [
    {
      weekday: "MON",
      blocks: [
        { exerciseId: "ex_squat", sets: 3, repRange: "5-8", restSec: 120 },
        { exerciseId: "ex_bench", sets: 3, repRange: "5-8", restSec: 120 },
        { exerciseId: "ex_row", sets: 3, repRange: "6-10", restSec: 90 },
      ],
    },
    {
      weekday: "WED",
      blocks: [
        { exerciseId: "ex_deadlift", sets: 3, repRange: "3-6", restSec: 150 },
        { exerciseId: "ex_ohp", sets: 3, repRange: "5-8", restSec: 120 },
        { exerciseId: "ex_pullup", sets: 3, repRange: "6-10", restSec: 90 },
      ],
    },
    {
      weekday: "FRI",
      blocks: [
        { exerciseId: "ex_squat", sets: 3, repRange: "5-8", restSec: 120 },
        { exerciseId: "ex_bench", sets: 3, repRange: "5-8", restSec: 120 },
        { exerciseId: "ex_plank", sets: 3, repRange: "30-60s", restSec: 60 },
      ],
    },
  ],
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeGymPoints(
  performed: { exerciseId: string; completed: boolean }[],
  plannedBlocks: { exerciseId: string; sets: number }[],
  primaryBodyPartOf: (exerciseId: string) => string | undefined,
): { totalPoints: number; byBodyPart: Record<string, number>; finishedBlocks: number } {
  const byBodyPart: Record<string, number> = {};
  let total = 0;
  let finishedBlocks = 0;

  for (const block of plannedBlocks) {
    const done = performed.filter((s) => s.exerciseId === block.exerciseId && s.completed).length;
    const within = Math.min(block.sets, done);
    if (within <= 0) continue;
    const part = primaryBodyPartOf(block.exerciseId);
    if (!part) continue;

    let points = within * BASE_POINTS_PER_COMPLETED_SET;
    if (within >= block.sets) {
      points += BLOCK_COMPLETION_BONUS;
      finishedBlocks += 1;
    }
    total += points;
    byBodyPart[part] = (byBodyPart[part] ?? 0) + points;
  }

  if (plannedBlocks.length > 0 && finishedBlocks === plannedBlocks.length) total += SESSION_COMPLETION_BONUS;

  for (const k of Object.keys(byBodyPart)) byBodyPart[k] = round2(byBodyPart[k]!);
  return { totalPoints: round2(total), byBodyPart, finishedBlocks };
}

export function estimate1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return round2(weight * (1 + reps / 30));
}
