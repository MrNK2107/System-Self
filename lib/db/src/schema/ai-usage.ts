import { date, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Per-user, per-local-day counters of AI-backed calls (`parse_call`, `voice_call`): the source of the daily limits.
 * Limits read only this table, never analytics_events. Rows go with the account.
 */
export const aiUsageDaily = pgTable(
  "ai_usage_daily",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date", { mode: "string" }).notNull(),
    name: text("name").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate, t.name] })],
);
