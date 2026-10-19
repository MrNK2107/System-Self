import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, primaryKey, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * A clanmate's anonymous weekly rating (PRD 8 SOCIAL). One row per (rater, ratee, ISO week); re-rating updates the
 * row. `weekKey` (`YYYY-Www`) is the ISO week of the RATER's local date. Nothing that reads this table for the ratee
 * may expose `raterId`: the ratee only ever gets the aggregate (peer_rating_weeks, the peer_rating_result notice).
 */
export const peerRatings = pgTable(
  "peer_ratings",
  {
    raterId: uuid("rater_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rateeId: uuid("ratee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekKey: text("week_key").notNull(),
    rating: integer("rating").notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.raterId, t.rateeId, t.weekKey] }),
    index("peer_ratings_ratee_week_idx").on(t.rateeId, t.weekKey),
    check("peer_ratings_rating_range", sql`${t.rating} between 1 and 5`),
    check("peer_ratings_no_self", sql`${t.raterId} <> ${t.rateeId}`),
    check("peer_ratings_week_key_valid", sql`${t.weekKey} ~ '^[0-9]{4}-W[0-9]{2}$'`),
  ],
);

/**
 * The weekly peer-rating evaluation of a ratee, written once per (user, ISO week) when the rollover of the week's
 * last local date finds at least 4 ratings. The row is the once-guarantee; it holds aggregates only.
 */
export const peerRatingWeeks = pgTable(
  "peer_rating_weeks",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekKey: text("week_key").notNull(),
    evaluatedOn: date("evaluated_on", { mode: "string" }).notNull(),
    ratingCount: integer("rating_count").notNull(),
    average: real("average").notNull(),
    /** The SOCIAL change actually applied (after clamping). */
    delta: real("delta").notNull().default(0),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.weekKey] })],
);
