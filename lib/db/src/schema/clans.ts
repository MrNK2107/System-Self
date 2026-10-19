import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * A clan of 8–30 players (PRD 15). Below 8 members it is `forming` (no raids, no rank). `clanScore`,
 * `activeMemberCount` and `clanRank` are written by the daily job (00:30 UTC); `scoredOn` is the UTC date of the
 * last score write.
 * `raidBonus` is the raid bonus accumulated in `raidBonusMonth` (`YYYY-MM`, UTC).
 */
export const clans = pgTable(
  "clans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    nameLower: text("name_lower").notNull(),
    tag: text("tag").notNull(),
    description: text("description"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: ts("created_at").defaultNow().notNull(),
    status: text("status").notNull().default("forming"),
    /** Null until scored, and whenever fewer than CLAN_SCORE_MIN_ACTIVE members are active (privacy). */
    clanScore: real("clan_score"),
    /** Members active in the activity window at the last daily score. */
    activeMemberCount: integer("active_member_count").notNull().default(0),
    clanRank: integer("clan_rank"),
    scoredOn: date("scored_on", { mode: "string" }),
    raidWins: integer("raid_wins").notNull().default(0),
    raidBonusMonth: text("raid_bonus_month"),
    raidBonus: real("raid_bonus").notNull().default(0),
    inviteCode: text("invite_code").notNull(),
  },
  (t) => [
    uniqueIndex("clans_name_lower_uq").on(t.nameLower),
    uniqueIndex("clans_invite_code_uq").on(t.inviteCode),
    index("clans_rank_idx").on(t.clanRank),
    check("clans_status_valid", sql`${t.status} in ('forming', 'active')`),
    check("clans_description_len", sql`${t.description} is null or char_length(${t.description}) <= 200`),
    check("clans_tag_valid", sql`${t.tag} ~ '^[A-Z]{2,5}$'`),
  ],
);

/** One clan per user (userId is the key). Exactly one leader per clan (partial unique index). */
export const clanMembers = pgTable(
  "clan_members",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    clanId: uuid("clan_id")
      .notNull()
      .references(() => clans.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    joinedAt: ts("joined_at").defaultNow().notNull(),
    /** Set by the dead-weight job after 5 consecutive inactive local days; cleared once active again. */
    flaggedAt: ts("flagged_at"),
  },
  (t) => [
    index("clan_members_clan_idx").on(t.clanId),
    uniqueIndex("clan_members_one_leader_uq").on(t.clanId).where(sql`${t.role} = 'leader'`),
    check("clan_members_role_valid", sql`${t.role} in ('leader', 'member')`),
  ],
);

/** SYSTEM dispatches shown inside a clan (membership changes; raid results from Task 5). No emoji. */
export const clanDispatches = pgTable(
  "clan_dispatches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clanId: uuid("clan_id")
      .notNull()
      .references(() => clans.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("clan_dispatches_clan_created_idx").on(t.clanId, t.createdAt.desc())],
);

/**
 * One clan's entry in a weekly raid (PRD 15). Written at the start of the week (`resolvedAt` null, `metricValue`
 * 0), settled at Sunday 23:59 UTC with the metric, the position in the group and the winner flag. `weekKey` is the
 * ISO week `YYYY-Www`; `groupId` ties the 2-4 clans that face each other. A clan raids once a week.
 */
export const clanRaids = pgTable(
  "clan_raids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weekKey: text("week_key").notNull(),
    type: text("type").notNull(),
    groupId: uuid("group_id").notNull(),
    clanId: uuid("clan_id")
      .notNull()
      .references(() => clans.id, { onDelete: "cascade" }),
    metricValue: real("metric_value").notNull().default(0),
    position: integer("position"),
    winner: boolean("winner").notNull().default(false),
    createdAt: ts("created_at").defaultNow().notNull(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [
    uniqueIndex("clan_raids_week_clan_uq").on(t.weekKey, t.clanId),
    index("clan_raids_group_idx").on(t.groupId),
    index("clan_raids_unresolved_idx").on(t.weekKey).where(sql`${t.resolvedAt} is null`),
    check("clan_raids_type_valid", sql`${t.type} in ('domain', 'discipline', 'body', 'score')`),
    check("clan_raids_week_key_valid", sql`${t.weekKey} ~ '^[0-9]{4}-W[0-9]{2}$'`),
  ],
);

/** The UTC date a daily job last completed (e.g. clan scores at 00:30 UTC). */
export const jobRuns = pgTable("job_runs", {
  job: text("job").primaryKey(),
  lastRunDate: date("last_run_date", { mode: "string" }).notNull(),
});

export type Clan = typeof clans.$inferSelect;
export type ClanMember = typeof clanMembers.$inferSelect;
export type ClanRaid = typeof clanRaids.$inferSelect;
export type ClanDispatch = typeof clanDispatches.$inferSelect;
