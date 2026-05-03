import type { Exercise, NewPrEvent, PersonalRecord, WorkoutSession } from "@/features/gym/model/types";

function estimate1Rm(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

export function computePrUpdates(
  session: WorkoutSession,
  exercisesById: Record<string, Exercise>,
  previousRecords: PersonalRecord[],
): { updatedRecords: PersonalRecord[]; newPrEvents: NewPrEvent[] } {
  const prevByExercise = new Map(previousRecords.map((pr) => [pr.exerciseId, pr]));
  const updated = [...previousRecords];
  const newPrEvents: NewPrEvent[] = [];

  const byExercise = new Map<string, { reps: number; weight: number; value: number }>();

  for (const set of session.performed) {
    const exercise = exercisesById[set.exerciseId];
    if (!exercise || !exercise.isBig5 || !set.completed) continue;
    const value = estimate1Rm(set.weight, set.reps);
    const prev = byExercise.get(set.exerciseId);
    if (!prev || value > prev.value) {
      byExercise.set(set.exerciseId, { reps: set.reps, weight: set.weight, value });
    }
  }

  for (const [exerciseId, best] of byExercise.entries()) {
    const current = prevByExercise.get(exerciseId);
    if (!current || best.value > current.value) {
      const nextRecord: PersonalRecord = {
        exerciseId,
        metricType: "weight_1rm_proxy",
        value: Number(best.value.toFixed(2)),
        reps: best.reps,
        weight: best.weight,
        achievedAt: session.completedAt ?? session.date,
      };

      const idx = updated.findIndex((x) => x.exerciseId === exerciseId);
      if (idx >= 0) updated[idx] = nextRecord;
      else updated.push(nextRecord);

      newPrEvents.push({
        exerciseId,
        exerciseName: exercisesById[exerciseId]?.name ?? exerciseId,
        value: nextRecord.value,
        achievedAt: nextRecord.achievedAt,
      });
    }
  }

  return { updatedRecords: updated, newPrEvents };
}

