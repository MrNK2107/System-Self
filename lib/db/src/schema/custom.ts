import { sql } from "drizzle-orm";
import { boolean, check, date, doublePrecision, index, integer, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * A user-defined stat (PRD 8 CUSTOM) with its own 0-100 score. Never part of the ranked domains: nothing here feeds
 * the hidden score, rank, decay, shadow, rivals or challenges. Only `isPublic` domains are ever shown to anyone else,
 * and then as name + score only. An archived domain keeps its history but cannot be logged or counted toward the limit.
 */
export const customDomains = pgTable(
  "custom_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    unit: text("unit").notNull().default(""),
    logLabel: text("log_label").notNull().default("Log"),
    baseline: doublePrecision("baseline").notNull(),
    target: doublePrecision("target").notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    score: real("score").notNull().default(50),
    streak: integer("streak").notNull().default(0),
    lastLogDate: date("last_log_date", { mode: "string" }),
    archivedAt: ts("archived_at"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("custom_domains_user_idx").on(t.userId),
    // Active names are unique per user, case-insensitively; an archived name is free again.
    uniqueIndex("custom_domains_user_name_active_idx")
      .on(t.userId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
    check("custom_domains_score_range", sql`${t.score} between 0 and 100`),
    check("custom_domains_name_length", sql`char_length(${t.name}) between 1 and 24`),
  ],
);

/** One value logged against a custom domain. (user, client id) is unique so an offline retry applies once. */
export const customLogs = pgTable(
  "custom_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    customDomainId: uuid("custom_domain_id")
      .notNull()
      .references(() => customDomains.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull(),
    value: doublePrecision("value").notNull(),
    note: text("note"),
    occurredAt: ts("occurred_at").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("custom_logs_user_client_idx").on(t.userId, t.clientId),
    index("custom_logs_domain_occurred_idx").on(t.customDomainId, t.occurredAt),
  ],
);

export type CustomDomainRow = typeof customDomains.$inferSelect;
export type CustomLogRow = typeof customLogs.$inferSelect;
