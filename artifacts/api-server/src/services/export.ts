// Data export ("download my data"): everything stored about the user, as one JSON document.
//
// Rules (Review Focus 3):
//  - Only rows the user owns. Rows shared with other players export the user's own side only.
//  - Other users never appear by id: they are replaced by the handle the user could already see (projectUser), or
//    FORMER OPERATOR when gone. A final sweep redacts any other user's id that slipped into a free-form JSON column.
//  - No password hash, token, code hash or other secret, and never the hidden score.
//  - Peer ratings received are aggregates only (peer_rating_weeks); rater ids are never exported.
//  - Built in memory: at current scale a user's data is well under a megabyte. Each table is capped at EXPORT_ROW_CAP rows
//    and any capped table is listed in meta.truncatedTables. Revisit with streaming if a user can exceed that.
import { desc, eq, or, sql } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as s from "@workspace/db/schema";
import { users, type Db } from "@workspace/db";
import { FORMER_OPERATOR_HANDLE } from "@workspace/contracts";
import { loadProjectionSubjects, projectUser, type ProjectionSubject, type Relation } from "./projection";

export const EXPORT_ROW_CAP = 50_000;

type Reader = Pick<Db, "select">;
type Row = Record<string, unknown>;

export interface ExportContext {
  db: Reader;
  me: string;
  now: Date;
  /** The handle the user may see for another user; FORMER OPERATOR when the account is gone. */
  handle(userId: string | null | undefined, relation?: Relation, rivalCodename?: string): Promise<string>;
}

type Loader = (ctx: ExportContext) => Promise<unknown>;

/** Tables with a user-id foreign key that are NOT exported, each with the reason. */
export const EXPORT_EXCLUDED: Record<string, string> = {
  email_codes: "One-time verification and reset code hashes: a secret.",
  idempotency_keys: "Technical replay cache of recent API responses; duplicates data exported from the real tables.",
};

const omit = (row: Row, keys: readonly string[]): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (!keys.includes(k)) out[k] = v;
  return out;
};

const ORDER_CANDIDATES = ["createdAt", "sentAt", "receivedAt", "occurredAt", "startedAt", "assignedAt", "unlockedAt", "achievedAt", "updatedAt", "localDate", "id"];

/** Newest-first ordering for a capped read: the first created/timestamp/date/id column the table has, else its first column. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function newest(table: PgTable): any {
  const t = table as unknown as Record<string, unknown>;
  const key = ORDER_CANDIDATES.find((k) => t[k] !== undefined);
  return desc((key ? t[key] : getTableConfig(table).columns[0]) as never);
}

/** All of the user's rows from a table keyed by a user column, minus the omitted properties. */
function owned(table: PgTable, column: unknown, omitted: readonly string[] = []): Loader {
  return async ({ db, me }) => {
    const rows = (await db
      .select()
      .from(table as never)
      .where(eq(column as never, me))
      .orderBy(newest(table))
      .limit(EXPORT_ROW_CAP)) as Row[];
    return omitted.length ? rows.map((r) => omit(r, omitted)) : rows;
  };
}

/** Only the named columns of the user's rows (the rest, such as hashes, is never read into the export). */
function picked(table: PgTable, column: unknown, keys: readonly string[]): Loader {
  return async ({ db, me }) => {
    const cols = Object.fromEntries(keys.map((k) => [k, (table as unknown as Record<string, unknown>)[k]]));
    return (await db
      .select(cols as never)
      .from(table as never)
      .where(eq(column as never, me))
      .orderBy(newest(table))
      .limit(EXPORT_ROW_CAP)) as Row[];
  };
}

export const EXPORT_TABLES: Record<string, Loader> = {
  // Session and device metadata only: never a token hash or push token.
  refresh_tokens: picked(s.refreshTokens, s.refreshTokens.userId, ["createdAt", "expiresAt", "revokedAt", "revokedReason", "userAgent"]),
  push_tokens: picked(s.pushTokens, s.pushTokens.userId, ["platform", "createdAt", "lastSeenAt"]),
  users: owned(users, users.id, ["passwordHash", "tokenVersion"]),
  profiles: owned(s.profiles, s.profiles.userId),
  domain_scores: owned(s.domainScores, s.domainScores.userId),
  score_events: owned(s.scoreEvents, s.scoreEvents.userId),
  // The hidden score is never exported.
  daily_snapshots: owned(s.dailySnapshots, s.dailySnapshots.userId, ["hidden"]),
  logs: owned(s.logs, s.logs.userId),
  quests: owned(s.quests, s.quests.userId),
  quest_chains: owned(s.questChains, s.questChains.userId),
  shadow_selves: owned(s.shadowSelves, s.shadowSelves.userId),
  achievements: owned(s.achievements, s.achievements.userId),
  milestones: owned(s.milestones, s.milestones.userId),
  notices: owned(s.notices, s.notices.userId),
  rank_freezes: owned(s.rankFreezes, s.rankFreezes.userId),
  user_day_state: owned(s.userDayState, s.userDayState.userId),
  debriefs: owned(s.debriefs, s.debriefs.userId),
  shadow_takeovers: owned(s.shadowTakeovers, s.shadowTakeovers.userId),
  comebacks: owned(s.comebacks, s.comebacks.userId),
  seasons: owned(s.seasons, s.seasons.userId),
  analytics_events: owned(s.analyticsEvents, s.analyticsEvents.userId),
  system_messages: owned(s.systemMessages, s.systemMessages.userId),
  generated_quest_batches: owned(s.generatedQuestBatches, s.generatedQuestBatches.userId),
  generated_quests: owned(s.generatedQuests, s.generatedQuests.userId),
  quest_completion_events: owned(s.questCompletionEvents, s.questCompletionEvents.userId),
  ai_usage_daily: owned(s.aiUsageDaily, s.aiUsageDaily.userId),
  notification_prefs: owned(s.notificationPrefs, s.notificationPrefs.userId),
  notification_log: owned(s.notificationLog, s.notificationLog.userId),
  notice_pushes: owned(s.noticePushes, s.noticePushes.userId),
  entitlements: owned(s.entitlements, s.entitlements.userId),
  // The provider payload carries ids and receipts; only the fact of each event is exported.
  billing_events: owned(s.billingEvents, s.billingEvents.userId, ["id", "payload"]),
  exercises: owned(s.exercises, s.exercises.userId),
  workout_plans: owned(s.workoutPlans, s.workoutPlans.userId),
  workout_sessions: owned(s.workoutSessions, s.workoutSessions.userId),
  performed_sets: async ({ db, me }) =>
    (
      await db
        .select({ set: s.performedSets })
        .from(s.performedSets)
        .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.performedSets.sessionId))
        .where(eq(s.workoutSessions.userId, me))
        .orderBy(newest(s.performedSets)).limit(EXPORT_ROW_CAP)
    ).map((r) => r.set),
  personal_records: owned(s.personalRecords, s.personalRecords.userId),
  body_part_scores: owned(s.bodyPartScores, s.bodyPartScores.userId),
  gym_crowd_reports: owned(s.gymCrowdReports, s.gymCrowdReports.userId),
  custom_domains: owned(s.customDomains, s.customDomains.userId),
  custom_logs: owned(s.customLogs, s.customLogs.userId),
  budgets: owned(s.budgets, s.budgets.userId),
  recurring_income: owned(s.recurringIncome, s.recurringIncome.userId),
  financial_goals: owned(s.financialGoals, s.financialGoals.userId),
  net_worth_snapshots: owned(s.netWorthSnapshots, s.netWorthSnapshots.userId),
  finance_weeks: owned(s.financeWeeks, s.financeWeeks.userId),
  // Peer ratings: the ratings the user gave. Ratings received are exported only as the weekly aggregates below.
  peer_ratings: async (ctx) => {
    const rows = await ctx.db.select().from(s.peerRatings).where(eq(s.peerRatings.raterId, ctx.me)).orderBy(newest(s.peerRatings)).limit(EXPORT_ROW_CAP);
    return Promise.all(
      rows.map(async (r) => ({
        ratee: await ctx.handle(r.rateeId, "public"),
        weekKey: r.weekKey,
        rating: r.rating,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    );
  },
  peer_rating_weeks: owned(s.peerRatingWeeks, s.peerRatingWeeks.userId),
  follows: async (ctx) => {
    const rows = await ctx.db.select().from(s.follows).where(eq(s.follows.followerId, ctx.me)).orderBy(newest(s.follows)).limit(EXPORT_ROW_CAP);
    const [followers] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(s.follows).where(eq(s.follows.followeeId, ctx.me));
    return {
      following: await Promise.all(rows.map(async (r) => ({ handle: await ctx.handle(r.followeeId, "follower"), since: r.createdAt }))),
      followerCount: followers?.n ?? 0,
    };
  },
  blocks: async (ctx) => {
    const rows = await ctx.db.select().from(s.blocks).where(eq(s.blocks.blockerId, ctx.me)).orderBy(newest(s.blocks)).limit(EXPORT_ROW_CAP);
    return Promise.all(rows.map(async (r) => ({ handle: await ctx.handle(r.blockedId), createdAt: r.createdAt })));
  },
  // Reports the user filed. Reports about the user are moderation records naming the reporter, so they are not exported.
  user_reports: async (ctx) => {
    const rows = await ctx.db.select().from(s.userReports).where(eq(s.userReports.reporterId, ctx.me)).orderBy(newest(s.userReports)).limit(EXPORT_ROW_CAP);
    return Promise.all(
      rows.map(async (r) => ({
        subject: r.subjectId ? await ctx.handle(r.subjectId) : (r.subjectHandle ?? FORMER_OPERATOR_HANDLE),
        reason: r.reason,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
      })),
    );
  },
  ghost_rivals: owned(s.ghostRivals, s.ghostRivals.ownerId),
  rival_assignments: async (ctx) => {
    const rows = await ctx.db.select().from(s.rivalAssignments).where(eq(s.rivalAssignments.userId, ctx.me)).orderBy(newest(s.rivalAssignments)).limit(EXPORT_ROW_CAP);
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        slot: r.slot,
        // A real rival is shown by the codename the user saw, never by the account behind it.
        rival: r.rivalUserId ? await ctx.handle(r.rivalUserId, "rival", r.codename) : r.codename,
        ghostId: r.ghostId,
        codename: r.codename,
        assignedAt: r.assignedAt,
        expiresAt: r.expiresAt,
      })),
    );
  },
  rival_pressure: owned(s.rivalPressure, s.rivalPressure.userId),
  rival_challenges: owned(s.rivalChallenges, s.rivalChallenges.userId),
  rival_taunts: owned(s.rivalTaunts, s.rivalTaunts.userId),
  // Named challenges: the user's own side only (the opponent's start and end values are theirs).
  named_challenges: async (ctx) => {
    const rows = await ctx.db
      .select()
      .from(s.namedChallenges)
      .where(or(eq(s.namedChallenges.challengerId, ctx.me), eq(s.namedChallenges.opponentId, ctx.me)))
      .orderBy(newest(s.namedChallenges)).limit(EXPORT_ROW_CAP);
    return Promise.all(
      rows.map(async (r) => {
        const mine = r.challengerId === ctx.me;
        return {
          id: r.id,
          role: mine ? "challenger" : "opponent",
          opponent: await ctx.handle(mine ? r.opponentId : r.challengerId),
          domain: r.domain,
          days: r.days,
          status: r.status,
          createdAt: r.createdAt,
          startDate: r.startDate,
          endDate: r.endDate,
          myStart: mine ? r.challengerStart : r.opponentStart,
          myEnd: mine ? r.challengerEnd : r.opponentEnd,
          outcome: r.outcome,
          won: r.winnerId ? r.winnerId === ctx.me : null,
          resolvedAt: r.resolvedAt,
        };
      }),
    );
  },
  duos: async (ctx) => {
    const rows = await ctx.db
      .select()
      .from(s.duos)
      .where(or(eq(s.duos.userA, ctx.me), eq(s.duos.userB, ctx.me)))
      .orderBy(newest(s.duos)).limit(EXPORT_ROW_CAP);
    return Promise.all(rows.map(async (r) => ({ id: r.id, partner: await ctx.handle(r.userA === ctx.me ? r.userB : r.userA, "duo"), createdAt: r.createdAt })));
  },
  duo_members: owned(s.duoMembers, s.duoMembers.userId),
  duo_invites: async (ctx) => {
    const rows = await ctx.db
      .select()
      .from(s.duoInvites)
      .where(or(eq(s.duoInvites.fromId, ctx.me), eq(s.duoInvites.toId, ctx.me)))
      .orderBy(newest(s.duoInvites)).limit(EXPORT_ROW_CAP);
    return Promise.all(
      rows.map(async (r) => {
        const sent = r.fromId === ctx.me;
        return { id: r.id, direction: sent ? "sent" : "received", other: await ctx.handle(sent ? r.toId : r.fromId), status: r.status, createdAt: r.createdAt };
      }),
    );
  },
  duo_checkins: owned(s.duoCheckins, s.duoCheckins.userId),
  // Clans: the user's own membership and its clan only. The invite code is a shared credential and is left out.
  clans: async ({ db, me }) => {
    const rows = await db
      .select({ clan: s.clans })
      .from(s.clanMembers)
      .innerJoin(s.clans, eq(s.clans.id, s.clanMembers.clanId))
      .where(eq(s.clanMembers.userId, me));
    return rows.map(({ clan }) => ({ ...omit(clan as Row, ["createdBy", "inviteCode"]), founder: clan.createdBy === me }));
  },
  clan_members: owned(s.clanMembers, s.clanMembers.userId),
  clan_dispatches: async (ctx) => {
    const rows = await ctx.db
      .select()
      .from(s.clanDispatches)
      .where(or(eq(s.clanDispatches.actorId, ctx.me), eq(s.clanDispatches.subjectId, ctx.me)))
      .orderBy(newest(s.clanDispatches)).limit(EXPORT_ROW_CAP);
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        clanId: r.clanId,
        kind: r.kind,
        text: r.text,
        templateKey: r.templateKey,
        actor: r.actorId ? await ctx.handle(r.actorId, "public") : null,
        subject: r.subjectId ? await ctx.handle(r.subjectId, "public") : null,
        createdAt: r.createdAt,
      })),
    );
  },
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export interface ExportResult {
  json: string;
  redacted: number;
}

/** Builds the export document inside one read-only snapshot transaction. */
export async function buildExport(db: Db, me: string, now: Date): Promise<ExportResult> {
  return db.transaction(
    async (tx) => {
      const cache = new Map<string, ProjectionSubject>();
      // Clanmates and duo partners are shown by username, as in the app; everyone else by what they chose to make public.
      const insiders = new Map<string, Relation>();
      const [membership] = await tx.select({ clanId: s.clanMembers.clanId }).from(s.clanMembers).where(eq(s.clanMembers.userId, me));
      if (membership) {
        for (const m of await tx.select({ id: s.clanMembers.userId }).from(s.clanMembers).where(eq(s.clanMembers.clanId, membership.clanId))) insiders.set(m.id, "clanmate");
      }
      for (const d of await tx.select().from(s.duos).where(or(eq(s.duos.userA, me), eq(s.duos.userB, me)))) insiders.set(d.userA === me ? d.userB : d.userA, "duo");
      const ctx: ExportContext = {
        db: tx,
        me,
        now,
        async handle(userId, requested = "public", rivalCodename) {
          if (!userId) return FORMER_OPERATOR_HANDLE;
          const relation = requested === "rival" ? requested : (insiders.get(userId) ?? requested);
          if (!cache.has(userId)) {
            for (const [id, subject] of await loadProjectionSubjects(tx, [userId], now)) cache.set(id, subject);
          }
          const subject = cache.get(userId);
          return subject ? projectUser(subject, relation, rivalCodename ? { rivalCodename } : {}).handle : FORMER_OPERATOR_HANDLE;
        },
      };
      const data: Record<string, unknown> = {};
      const truncatedTables: string[] = [];
      for (const [name, load] of Object.entries(EXPORT_TABLES)) {
        const out = await load(ctx);
        data[name] = out;
        if (Array.isArray(out) && out.length >= EXPORT_ROW_CAP) truncatedTables.push(name);
      }
      const doc = {
        meta: {
          format: "system-self-export",
          version: 1,
          exportedAt: now.toISOString(),
          userId: me,
          rowCapPerTable: EXPORT_ROW_CAP,
          truncatedTables,
          notExported: EXPORT_EXCLUDED,
          notes: [
            "Other players appear only by the handle you could see. Peer ratings you received are included as weekly aggregates only.",
            "Secrets (password hash, session tokens, one-time codes, device push tokens) are never exported.",
          ],
        },
        data,
      };
      let json = JSON.stringify(doc, null, 2);
      // Safety net: any other account's id inside a free-form JSON column is redacted.
      const found = [...new Set((json.match(UUID_RE) ?? []).map((x) => x.toLowerCase()))].filter((x) => x !== me.toLowerCase());
      let redacted = 0;
      if (found.length) {
        const others = await tx
          .select({ id: users.id })
          .from(users)
          .where(sql`${users.id} = any(${`{${found.join(",")}}`}::uuid[])`);
        for (const o of others) {
          json = json.split(o.id).join("[REDACTED]");
          redacted += 1;
        }
      }
      return { json, redacted };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
