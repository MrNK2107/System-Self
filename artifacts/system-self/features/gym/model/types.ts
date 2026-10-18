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

export interface Exercise {
  id: string;
  name: string;
  primaryBodyPart: BodyPart;
  secondaryBodyParts: BodyPart[];
  isBig5: boolean;
}

export interface WorkoutBlock {
  exerciseId: string;
  sets: number;
  repRange: string;
  restSec: number;
  notes?: string;
}

export interface WorkoutDay {
  id: string;
  planId: string;
  weekday: Weekday;
  blocks: WorkoutBlock[];
}

export interface WorkoutPlan {
  id: string;
  name: string;
  goal: string;
  days: WorkoutDay[];
}

export interface PerformedSet {
  exerciseId: string;
  setIndex: number;
  reps: number;
  weight: number;
  completed: boolean;
}

export interface WorkoutSession {
  id: string;
  date: string;
  planId?: string;
  completedAt?: string;
  /** Server-awarded BODY points (0 until completed). */
  points: number;
  performed: PerformedSet[];
}

export interface PersonalRecord {
  exerciseId: string;
  metricType: "weight_1rm_proxy";
  value: number;
  reps: number;
  weight: number;
  achievedAt: string;
}

export interface BodyPartScore {
  bodyPart: BodyPart;
  pointsTotal: number;
  lastUpdatedAt: string;
}

export interface NewPrEvent {
  exerciseId: string;
  exerciseName: string;
  value: number;
  achievedAt: string;
}

