// Mirrors the exercise seed INSERT in migrations/0005_*.sql and the later exercise seed migration (and DEFAULT_EXERCISES in @workspace/engine).
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
  { id: "ex_db_press", name: "Dumbbell Bench Press", primaryBodyPart: "chest", secondaryBodyParts: ["triceps", "shoulders"], isBig5: false },
  { id: "ex_goblet_squat", name: "Goblet Squat", primaryBodyPart: "quads", secondaryBodyParts: ["glutes", "core"], isBig5: false },
  { id: "ex_lat_pulldown", name: "Lat Pulldown", primaryBodyPart: "back", secondaryBodyParts: ["biceps"], isBig5: false },
  { id: "ex_leg_press", name: "Leg Press", primaryBodyPart: "quads", secondaryBodyParts: ["glutes", "hamstrings"], isBig5: false },
  { id: "ex_db_row", name: "Dumbbell Row", primaryBodyPart: "back", secondaryBodyParts: ["biceps", "core"], isBig5: false },
  { id: "ex_pushup", name: "Push-up", primaryBodyPart: "chest", secondaryBodyParts: ["triceps", "shoulders", "core"], isBig5: false },
  { id: "ex_rdl_db", name: "Dumbbell Romanian Deadlift", primaryBodyPart: "hamstrings", secondaryBodyParts: ["glutes", "back"], isBig5: false },
  { id: "ex_db_shoulder_press", name: "Dumbbell Shoulder Press", primaryBodyPart: "shoulders", secondaryBodyParts: ["triceps"], isBig5: false },
  { id: "ex_glute_bridge", name: "Glute Bridge", primaryBodyPart: "glutes", secondaryBodyParts: ["hamstrings", "core"], isBig5: false },
  { id: "ex_bodyweight_squat", name: "Bodyweight Squat", primaryBodyPart: "quads", secondaryBodyParts: ["glutes"], isBig5: false },
  { id: "ex_inverted_row", name: "Inverted Row", primaryBodyPart: "back", secondaryBodyParts: ["biceps", "core"], isBig5: false },
  { id: "ex_dead_bug", name: "Dead Bug", primaryBodyPart: "core", secondaryBodyParts: [], isBig5: false },
];
