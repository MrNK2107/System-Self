import { sql } from "drizzle-orm";
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
import { generatedQuestBatches } from "./system_ai";
import { users } from "./users";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const userIdCol = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

// Text enums (rank, domain, reason, status, kind, ...) are validated in application code.
// No $onUpdate: services set updatedAt explicitly.

export const profiles = pgTable("profiles", {
  userId: userIdCol().primaryKey(),
  identitySetting: text("identity_setting").notNull().default("semi-public"),
  primaryGoal: text("primary_goal").notNull(),
  biggestWeakness: text("biggest_weakness").notNull(),
  stoppedBefore: text("stopped_before"),
  morningTime: text("morning_time").notNull().default("07:00"),
  nightlyTime: text("nightly_time").notNull().default("21:00"),
  rank: text("rank").notNull().default("E"),
  rankSince: ts("rank_since").defaultNow().notNull(),
  codename: text("codename").notNull(),
  onboardedAt: ts("onboarded_at").defaultNow().notNull(),
  onboardingRatings: jsonb("onboarding_ratings").notNull(),
  rankFreezeUntil: date("rank_freeze_until", { mode: "string" }),
  rankFreezeUsedMonth: text("rank_freeze_used_month"), // YYYY-MM
  /** Home path (Tier I): BODY quests are home sessions until `homeSessions` reaches the unlock count. */
  homePathActive: boolean("home_path_active").notNull().default(false),
  homeSessions: integer("home_sessions").notNull().default(0),
  /** Completed comeback checklists ("Returned ×n"). Recognition only, never a score. */
  returnerCount: integer("returner_count").notNull().default(0),
  /** Life context shaping quest content (never the score). */
  lifeContext: text("life_context").notNull().default("student"),
  /** "Past You" baseline: the ranked-domain scores at onboarding (backfilled from the first snapshot) and their date. */
  baselineScores: jsonb("baseline_scores"),
  baselineDate: date("baseline_date", { mode: "string" }),
  /** Public codename (`USER // WORD-N`) shown to other players whenever the identity setting hides the username. Unique. */
  publicCodename: text("public_codename").notNull().unique(),
  /** ISO 4217 code the finance amounts are in (private; never projected). */
  currency: text("currency").notNull().default("INR"),
  /** Stated savings rate target, 0..0.9 (the weekly WEALTH evaluation). */
  savingsTarget: real("savings_target").notNull().default(0.2),
});

export const domainScores = pgTable(
  "domain_scores",
  {
    userId: userIdCol(),
    domain: text("domain").notNull(),
    score: real("score").notNull(),
    streak: integer("streak").notNull().default(0),
    lastLogDate: date("last_log_date", { mode: "string" }),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.domain] })],
);

export const scoreEvents = pgTable(
  "score_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: userIdCol(),
    domain: text("domain").notNull(),
    delta: real("delta").notNull(), // requested
    actualDelta: real("actual_delta").notNull(),
    reason: text("reason").notNull(),
    refId: text("ref_id"),
    localDate: date("local_date", { mode: "string" }).notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("score_events_user_created_idx").on(t.userId, t.createdAt),
    index("score_events_user_local_date_idx").on(t.userId, t.localDate),
  ],
);

export const logs = pgTable(
  "logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    clientId: text("client_id").notNull(),
    domain: text("domain").notNull(),
    logType: text("log_type").notNull(),
    data: jsonb("data").notNull().default({}),
    freeText: text("free_text"),
    forbidden: boolean("forbidden").notNull().default(false),
    occurredAt: ts("occurred_at").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    isRetroactive: boolean("is_retroactive").notNull().default(false),
    /**
     * Written by the server on the user's behalf (recurring income). Never activity: decay, streaks, comebacks, clans,
     * rivals and counts skip it. Only server code sets it; a client cannot.
     */
    system: boolean("system").notNull().default(false),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("logs_user_client_id_idx").on(t.userId, t.clientId),
    index("logs_user_occurred_at_idx").on(t.userId, t.occurredAt.desc()),
    // Rollover inactivity (latest log date up to D) and the weekly recap filter by local date.
    index("logs_user_local_date_idx").on(t.userId, t.localDate),
    // Adherence metrics scan BODY logs only (second-visit lookups per user and date).
    index("logs_body_user_local_date_idx").on(t.userId, t.localDate).where(sql`${t.domain} = 'BODY'`),
  ],
);

export const quests = pgTable(
  "quests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    batchId: integer("batch_id").references(() => generatedQuestBatches.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    domain: text("domain").notNull(),
    status: text("status").notNull().default("active"), // active | complete | failed | refused
    expiresAt: ts("expires_at").notNull(),
    resolvedAt: ts("resolved_at"),
    resolvedLocalDate: date("resolved_local_date", { mode: "string" }),
    generatedBySystem: boolean("generated_by_system").notNull().default(true),
    chainId: uuid("chain_id"),
    chainStep: integer("chain_step"),
    chainTotal: integer("chain_total"),
    refusalReason: text("refusal_reason"),
    slotStart: text("slot_start"), // HH:MM local, set by hand (Lock the Slot); never changes when the quest fails
    slotEnd: text("slot_end"),
    /** PRO Shame Mode (PRD 11): when this quest fails the clan is told its title. Explicit per-quest opt-in. */
    shameMode: boolean("shame_mode").notNull().default(false),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("quests_user_status_expires_idx").on(t.userId, t.status, t.expiresAt)],
);

export const questChains = pgTable(
  "quest_chains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    templateKey: text("template_key").notNull(),
    name: text("name").notNull(),
    domain: text("domain").notNull(),
    currentStep: integer("current_step").notNull().default(0),
    totalSteps: integer("total_steps").notNull(),
    status: text("status").notNull().default("active"),
    startedAt: ts("started_at").defaultNow().notNull(),
    completedAt: ts("completed_at"),
  },
  (t) => [
    uniqueIndex("quest_chains_active_template_idx")
      .on(t.userId, t.templateKey)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const shadowSelves = pgTable("shadow_selves", {
  userId: userIdCol().primaryKey(),
  active: boolean("active").notNull().default(false),
  codename: text("codename").notNull(),
  initialScores: jsonb("initial_scores"),
  gainRates: jsonb("gain_rates"),
  activatedAt: ts("activated_at"),
  resolvedAt: ts("resolved_at"),
  gapAtActivation: real("gap_at_activation"),
});

export const achievements = pgTable(
  "achievements",
  {
    userId: userIdCol(),
    achievementId: text("achievement_id").notNull(),
    unlockedAt: ts("unlocked_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementId] })],
);

export const milestones = pgTable(
  "milestones",
  {
    userId: userIdCol(),
    domain: text("domain").notNull(),
    tier: integer("tier").notNull(),
    unlockedAt: ts("unlocked_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.domain, t.tier] })],
);

export const notices = pgTable(
  "notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
    seenAt: ts("seen_at"),
  },
  (t) => [index("notices_user_seen_created_idx").on(t.userId, t.seenAt, t.createdAt)],
);

export const dailySnapshots = pgTable(
  "daily_snapshots",
  {
    userId: userIdCol(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    scores: jsonb("scores").notNull(),
    hidden: real("hidden").notNull(),
    rank: text("rank").notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate] })],
);

export const userDayState = pgTable(
  "user_day_state",
  {
    userId: userIdCol().primaryKey(),
    lastRolledDate: date("last_rolled_date", { mode: "string" }), // last local date fully rolled
    nextRolloverAt: ts("next_rollover_at").notNull(),
    lastActivityDate: date("last_activity_date", { mode: "string" }),
  },
  (t) => [index("user_day_state_next_rollover_idx").on(t.nextRolloverAt)],
);

export const debriefs = pgTable(
  "debriefs",
  {
    userId: userIdCol(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    deltas: jsonb("deltas"),
    questCompleted: integer("quest_completed"),
    questTotal: integer("quest_total"),
    verdict: text("verdict"),
    text: text("text"),
    model: text("model"),
    acknowledgedAt: ts("acknowledged_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate] })],
);

// Rows older than 7 days are pruned by the worker.
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: userIdCol(),
    key: text("key").notNull(),
    route: text("route"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] }), index("idempotency_keys_created_idx").on(t.createdAt)],
);

export type Profile = typeof profiles.$inferSelect;
export type DomainScore = typeof domainScores.$inferSelect;
export type ScoreEvent = typeof scoreEvents.$inferSelect;
export type Log = typeof logs.$inferSelect;
export type Quest = typeof quests.$inferSelect;
export type QuestChain = typeof questChains.$inferSelect;
export type ShadowSelf = typeof shadowSelves.$inferSelect;
export type Notice = typeof notices.$inferSelect;
export type DailySnapshot = typeof dailySnapshots.$inferSelect;
export type UserDayState = typeof userDayState.$inferSelect;
export type Debrief = typeof debriefs.$inferSelect;

/** A refused BODY quest the Shadow Self "took". Display and narrative only; never feeds any score. */
export const shadowTakeovers = pgTable(
  "shadow_takeovers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    questId: uuid("quest_id").notNull(),
    questTitle: text("quest_title").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("shadow_takeovers_user_date_idx").on(t.userId, t.localDate)],
);

/** Fire-and-forget product analytics. userId is nulled when the account is deleted. */
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    props: jsonb("props").notNull().default(sql`'{}'::jsonb`),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("analytics_events_name_created_idx").on(t.name, t.createdAt)],
);

/** A return after 5+ empty days. The checklist is recognition only: completing it pays no score. */
export const comebacks = pgTable(
  "comebacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    startedOn: date("started_on", { mode: "string" }).notNull(),
    gapDays: integer("gap_days").notNull(),
    checklist: jsonb("checklist").notNull().default(sql`'[]'::jsonb`),
    completedAt: ts("completed_at"),
  },
  (t) => [uniqueIndex("comebacks_user_started_idx").on(t.userId, t.startedOn)],
);

/** A scheduled stretch (1-14 days) in which quests shrink. Scoring is unchanged. */
export const seasons = pgTable(
  "seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    kind: text("kind").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("seasons_user_ends_idx").on(t.userId, t.endsOn)],
);
