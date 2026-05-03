import type { BodyPart, Exercise, Weekday } from "@/features/gym/model/types";

export const BODY_PARTS: BodyPart[] = [
  "chest",
  "back",
  "quads",
  "hamstrings",
  "shoulders",
  "biceps",
  "triceps",
  "core",
  "glutes",
  "calves",
];

export const WEEKDAYS: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const BIG5_EXERCISE_NAMES = [
  "Back Squat",
  "Bench Press",
  "Deadlift",
  "Overhead Press",
  "Barbell Row",
] as const;

export const DEFAULT_EXERCISES: Exercise[] = [
  { id: "ex_squat", name: "Back Squat", primaryBodyPart: "quads", secondaryBodyParts: ["glutes", "core"], isBig5: true },
  { id: "ex_bench", name: "Bench Press", primaryBodyPart: "chest", secondaryBodyParts: ["triceps", "shoulders"], isBig5: true },
  { id: "ex_deadlift", name: "Deadlift", primaryBodyPart: "hamstrings", secondaryBodyParts: ["back", "glutes"], isBig5: true },
  { id: "ex_ohp", name: "Overhead Press", primaryBodyPart: "shoulders", secondaryBodyParts: ["triceps", "core"], isBig5: true },
  { id: "ex_row", name: "Barbell Row", primaryBodyPart: "back", secondaryBodyParts: ["biceps", "core"], isBig5: true },
  { id: "ex_pullup", name: "Pull-up", primaryBodyPart: "back", secondaryBodyParts: ["biceps"], isBig5: false },
  { id: "ex_lunge", name: "Walking Lunge", primaryBodyPart: "quads", secondaryBodyParts: ["glutes"], isBig5: false },
  { id: "ex_plank", name: "Plank", primaryBodyPart: "core", secondaryBodyParts: [], isBig5: false },
];

