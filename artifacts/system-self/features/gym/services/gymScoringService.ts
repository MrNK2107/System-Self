import type { BodyPart, BodyPartScore, Exercise, WorkoutBlock, WorkoutSession } from "@/features/gym/model/types";

const BASE_POINTS_PER_COMPLETED_SET = 1.2;
const BLOCK_COMPLETION_BONUS = 1.5;
const SESSION_COMPLETION_BONUS = 2.0;

export interface ComputedGymPoints {
  totalPoints: number;
  bodyPartPoints: Record<BodyPart, number>;
  completedSetCount: number;
  completedBlockCount: number;
  sessionBonusApplied: boolean;
}

export function computeGymPoints(
  session: WorkoutSession,
  plannedBlocks: WorkoutBlock[],
  exercisesById: Record<string, Exercise>,
): ComputedGymPoints {
  const bodyPartPoints = {
    chest: 0, back: 0, quads: 0, hamstrings: 0, shoulders: 0,
    biceps: 0, triceps: 0, core: 0, glutes: 0, calves: 0,
  } as Record<BodyPart, number>;

  let totalPoints = 0;
  let completedSetCount = 0;
  let completedBlockCount = 0;

  for (const block of plannedBlocks) {
    const performedForExercise = session.performed.filter(
      (set) => set.exerciseId === block.exerciseId && set.completed,
    );
    const completedWithinBlock = Math.min(block.sets, performedForExercise.length);
    if (completedWithinBlock <= 0) continue;

    const ex = exercisesById[block.exerciseId];
    if (!ex) continue;

    const setPoints = completedWithinBlock * BASE_POINTS_PER_COMPLETED_SET;
    totalPoints += setPoints;
    completedSetCount += completedWithinBlock;
    bodyPartPoints[ex.primaryBodyPart] += setPoints;

    if (completedWithinBlock >= block.sets) {
      totalPoints += BLOCK_COMPLETION_BONUS;
      completedBlockCount += 1;
      bodyPartPoints[ex.primaryBodyPart] += BLOCK_COMPLETION_BONUS;
    }
  }

  const sessionBonusApplied = plannedBlocks.length > 0 && completedBlockCount === plannedBlocks.length;
  if (sessionBonusApplied) {
    totalPoints += SESSION_COMPLETION_BONUS;
  }

  return {
    totalPoints,
    bodyPartPoints,
    completedSetCount,
    completedBlockCount,
    sessionBonusApplied,
  };
}

export function mergeBodyPartScores(
  prevScores: BodyPartScore[],
  bodyPartPoints: Record<BodyPart, number>,
  at: string,
): BodyPartScore[] {
  const prevMap = new Map(prevScores.map((x) => [x.bodyPart, x]));
  return (Object.keys(bodyPartPoints) as BodyPart[]).map((bodyPart) => {
    const prev = prevMap.get(bodyPart);
    const add = bodyPartPoints[bodyPart] ?? 0;
    return {
      bodyPart,
      pointsTotal: Number(((prev?.pointsTotal ?? 0) + add).toFixed(2)),
      lastUpdatedAt: add > 0 ? at : (prev?.lastUpdatedAt ?? at),
    };
  });
}

