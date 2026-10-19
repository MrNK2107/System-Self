import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const userRef = (name: string) =>
  uuid(name)
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/** follower -> followee. Only public / semi-public users can be followed (checked by the route, not here). */
export const follows = pgTable(
  "follows",
  {
    followerId: userRef("follower_id"),
    followeeId: userRef("followee_id"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index("follows_followee_idx").on(t.followeeId),
    check("follows_not_self", sql`${t.followerId} <> ${t.followeeId}`),
  ],
);

/** blocker -> blocked. A block in either direction stops follows, and later rival matching, challenges and invites. */
export const blocks = pgTable(
  "blocks",
  {
    blockerId: userRef("blocker_id"),
    blockedId: userRef("blocked_id"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index("blocks_blocked_idx").on(t.blockedId),
    check("blocks_not_self", sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

/** Reports stored for admin review. */
export const userReports = pgTable(
  "user_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: userRef("reporter_id"),
    subjectId: userRef("subject_id"),
    reason: text("reason").notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [
    index("user_reports_subject_idx").on(t.subjectId),
    // One open report per (reporter, subject); a resolved one can be filed again.
    uniqueIndex("user_reports_open_uq").on(t.reporterId, t.subjectId).where(sql`${t.resolvedAt} is null`),
    check("user_reports_reason_len", sql`char_length(${t.reason}) between 1 and 500`),
  ],
);

export type Follow = typeof follows.$inferSelect;
export type Block = typeof blocks.$inferSelect;
export type UserReport = typeof userReports.$inferSelect;
