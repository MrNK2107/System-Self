import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const userIdCol = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

// Seeded exercises (ex_*, userId null) are inserted by the migration.
export const exercises = pgTable(
  "exercises",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    primaryBodyPart: text("primary_body_part").notNull(),
    secondaryBodyParts: jsonb("secondary_body_parts").$type<string[]>().notNull().default([]),
    isBig5: boolean("is_big5").notNull().default(false),
  },
  (t) => [index("exercises_user_idx").on(t.userId)],
);

export interface PlanBlock {
  exerciseId: string;
  sets: number;
  repRange: string;
  restSec: number;
  notes?: string;
}
export interface PlanDay {
  weekday: string;
  blocks: PlanBlock[];
}

export const workoutPlans = pgTable(
  "workout_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    name: text("name").notNull(),
    goal: text("goal").notNull(),
    days: jsonb("days").$type<PlanDay[]>().notNull(),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("workout_plans_user_idx").on(t.userId)],
);

export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    planId: uuid("plan_id").references(() => workoutPlans.id, { onDelete: "set null" }),
    startedAt: ts("started_at").notNull(),
    completedAt: ts("completed_at"),
    localDate: date("local_date", { mode: "string" }).notNull(),
    points: real("points").notNull().default(0),
    clientId: text("client_id").notNull(),
  },
  (t) => [uniqueIndex("workout_sessions_user_client_id_idx").on(t.userId, t.clientId)],
);

export const performedSets = pgTable(
  "performed_sets",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => workoutSessions.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id").notNull(),
    setIndex: integer("set_index").notNull(),
    reps: integer("reps").notNull(),
    weight: real("weight").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
  },
  (t) => [index("performed_sets_session_idx").on(t.sessionId)],
);

export const personalRecords = pgTable(
  "personal_records",
  {
    userId: userIdCol(),
    exerciseId: text("exercise_id").notNull(),
    value: real("value").notNull(),
    reps: integer("reps").notNull(),
    weight: real("weight").notNull(),
    achievedAt: ts("achieved_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.exerciseId] })],
);

export const bodyPartScores = pgTable(
  "body_part_scores",
  {
    userId: userIdCol(),
    bodyPart: text("body_part").notNull(),
    points: real("points").notNull().default(0),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.bodyPart] })],
);

export const gymCrowdReports = pgTable(
  "gym_crowd_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    sessionId: uuid("session_id").references(() => workoutSessions.id, { onDelete: "set null" }),
    level: text("level").notNull(), // quiet | normal | packed
    weekday: integer("weekday").notNull(), // 0 (SUN) .. 6 (SAT), user-local
    hour: integer("hour").notNull(), // 0..23, user-local
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("gym_crowd_reports_user_idx").on(t.userId)],
);

export type Exercise = typeof exercises.$inferSelect;
export type WorkoutPlan = typeof workoutPlans.$inferSelect;
export type WorkoutSession = typeof workoutSessions.$inferSelect;
export type PerformedSet = typeof performedSets.$inferSelect;
export type GymCrowdReport = typeof gymCrowdReports.$inferSelect;
