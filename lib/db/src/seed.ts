// Mirrors the exercise seed INSERT in migrations/0005_*.sql (and DEFAULT_EXERCISES in @workspace/engine).
// Used by resetDb() to restore seeded rows after TRUNCATE; game.test.ts asserts all three agree.
export const SEED_EXERCISES = [
  { id: "ex_squat", name: "Back Squat", primaryBodyPart: "quads", secondaryBodyParts: ["glutes", "core"], isBig5: true },
  { id: "ex_bench", name: "Bench Press", primaryBodyPart: "chest", secondaryBodyParts: ["triceps", "shoulders"], isBig5: true },
  { id: "ex_deadlift", name: "Deadlift", primaryBodyPart: "hamstrings", secondaryBodyParts: ["back", "glutes"], isBig5: true },
  { id: "ex_ohp", name: "Overhead Press", primaryBodyPart: "shoulders", secondaryBodyParts: ["triceps", "core"], isBig5: true },
  { id: "ex_row", name: "Barbell Row", primaryBodyPart: "back", secondaryBodyParts: ["biceps", "core"], isBig5: true },
  { id: "ex_pullup", name: "Pull-up", primaryBodyPart: "back", secondaryBodyParts: ["biceps"], isBig5: false },
  { id: "ex_lunge", name: "Walking Lunge", primaryBodyPart: "quads", secondaryBodyParts: ["glutes"], isBig5: false },
  { id: "ex_plank", name: "Plank", primaryBodyPart: "core", secondaryBodyParts: [], isBig5: false },
];
