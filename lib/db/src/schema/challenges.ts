import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * A PRO named challenge (PRD 14): one ranked domain, 3/7/14/30 days, metric = domain score gain over the window.
 * `pending` until the opponent accepts (or ignores, or 48 h pass: `respondBy`), then `active` from `startDate`
 * (the acceptor's local date) to `endDate`, then `resolved` (winner +3.0 / loser -1.5 DISCIPLINE, a draw changes
 * nothing). `void` when either account is gone (the user FKs are SET NULL so the row survives). The `*Start`
 * values are captured at acceptance, the `*End` values when it resolves. `winnerId` is null for a draw or void.
 */
export const namedChallenges = pgTable(
  "named_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengerId: uuid("challenger_id").references(() => users.id, { onDelete: "set null" }),
    opponentId: uuid("opponent_id").references(() => users.id, { onDelete: "set null" }),
    domain: text("domain").notNull(),
    days: integer("days").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: ts("created_at").defaultNow().notNull(),
    respondBy: ts("respond_by").notNull(),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    challengerStart: real("challenger_start"),
    opponentStart: real("opponent_start"),
    challengerEnd: real("challenger_end"),
    opponentEnd: real("opponent_end"),
    winnerId: uuid("winner_id").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: ts("resolved_at"),
    /** Last time the social job tried to settle it (rotation, so a challenge that keeps deferring cannot starve the rest). */
    lastAttemptAt: ts("last_attempt_at"),
  },
  (t) => [
    index("named_challenges_challenger_idx").on(t.challengerId, t.status),
    index("named_challenges_opponent_idx").on(t.opponentId, t.status),
    index("named_challenges_open_idx").on(t.status, t.respondBy),
    check("named_challenges_days_valid", sql`${t.days} in (3, 7, 14, 30)`),
    check("named_challenges_status_valid", sql`${t.status} in ('pending', 'active', 'ignored', 'resolved', 'void')`),
    check("named_challenges_distinct", sql`${t.challengerId} is null or ${t.opponentId} is null or ${t.challengerId} <> ${t.opponentId}`),
  ],
);

export type NamedChallenge = typeof namedChallenges.$inferSelect;
