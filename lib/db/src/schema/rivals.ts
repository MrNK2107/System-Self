import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
const ownerRef = (name: string) =>
  uuid(name)
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/** A server-simulated rival owned by one user (cold start). Drifts once per owner rollover date. */
export const ghostRivals = pgTable(
  "ghost_rivals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerRef("owner_id"),
    codename: text("codename").notNull(),
    rank: text("rank").notNull(),
    /** Ranked-domain scores (all five). */
    scores: jsonb("scores").notNull(),
    trajectory: text("trajectory").notNull(),
    shadowActive: boolean("shadow_active").notNull().default(false),
    /** The last owner-local date whose drift was applied. */
    lastDriftDate: date("last_drift_date", { mode: "string" }),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("ghost_rivals_owner_idx").on(t.ownerId)],
);

/** One of a user's three rival slots: a real player (rivalUserId) or a ghost (ghostId), never both. */
export const rivalAssignments = pgTable(
  "rival_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerRef("user_id"),
    slot: integer("slot").notNull(),
    rivalUserId: uuid("rival_user_id").references(() => users.id, { onDelete: "cascade" }),
    ghostId: uuid("ghost_id").references(() => ghostRivals.id, { onDelete: "cascade" }),
    /** `RIVAL // WORD-N`, the only handle this user ever sees for the rival. */
    codename: text("codename").notNull(),
    assignedAt: ts("assigned_at").defaultNow().notNull(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("rival_assignments_user_slot_uq").on(t.userId, t.slot),
    index("rival_assignments_rival_idx").on(t.rivalUserId),
    index("rival_assignments_expires_idx").on(t.expiresAt),
    check("rival_assignments_slot_range", sql`${t.slot} between 1 and 3`),
    check("rival_assignments_one_rival", sql`(${t.rivalUserId} is null) <> (${t.ghostId} is null)`),
  ],
);

/** Per rival and domain: whether the rival was ahead of the user at the last check (rival pressure). */
export const rivalPressure = pgTable(
  "rival_pressure",
  {
    userId: ownerRef("user_id"),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => rivalAssignments.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    ahead: boolean("ahead").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.assignmentId, t.domain] })],
);

/**
 * A free 7-day, one-domain gain-vs-gain challenge against an assigned rival. No score effect. `outcome` is null
 * while open; win/loss/draw at resolution; void when the rival is gone. One open challenge per assignment.
 */
export const rivalChallenges = pgTable(
  "rival_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerRef("user_id"),
    assignmentId: uuid("assignment_id").references(() => rivalAssignments.id, { onDelete: "set null" }),
    /** The rival's codename at declaration (kept after the slot is re-matched). */
    codename: text("codename").notNull(),
    domain: text("domain").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    userStart: real("user_start").notNull(),
    rivalStart: real("rival_start").notNull(),
    userEnd: real("user_end"),
    rivalEnd: real("rival_end"),
    outcome: text("outcome"),
    resolvedAt: ts("resolved_at"),
    acknowledgedAt: ts("acknowledged_at"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("rival_challenges_user_idx").on(t.userId),
    uniqueIndex("rival_challenges_open_uq").on(t.assignmentId).where(sql`${t.outcome} is null`),
  ],
);

/** A rival transmission (rival_taunt message), at most one per rival per owner-local day. */
export const rivalTaunts = pgTable(
  "rival_taunts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: ownerRef("user_id"),
    assignmentId: uuid("assignment_id").references(() => rivalAssignments.id, { onDelete: "set null" }),
    codename: text("codename").notNull(),
    message: text("message").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
    readAt: ts("read_at"),
  },
  (t) => [
    index("rival_taunts_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("rival_taunts_daily_uq").on(t.userId, t.assignmentId, t.localDate),
  ],
);

export type GhostRival = typeof ghostRivals.$inferSelect;
export type RivalAssignment = typeof rivalAssignments.$inferSelect;
export type RivalChallengeRow = typeof rivalChallenges.$inferSelect;
export type RivalTauntRow = typeof rivalTaunts.$inferSelect;
