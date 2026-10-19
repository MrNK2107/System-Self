import { boolean, date, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { notices } from "./game";
import { users } from "./users";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const userIdCol = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/** Expo push tokens, one row per device token. Re-registering a token moves it to the signed-in user. */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    token: text("token").notNull().unique(),
    platform: text("platform").notNull(), // ios | android
    createdAt: ts("created_at").defaultNow().notNull(),
    lastSeenAt: ts("last_seen_at").defaultNow().notNull(),
  },
  // last_seen_at: the orphaned-token prune (worker) scans tokens not seen for 30 days.
  (t) => [index("push_tokens_user_idx").on(t.userId), index("push_tokens_last_seen_idx").on(t.lastSeenAt)],
);

/** Missing row = everything on. `morning` / `nightly` are on-device reminders (they reserve cap slots); `events` the server pushes. */
export const notificationPrefs = pgTable("notification_prefs", {
  userId: userIdCol().primaryKey(),
  morning: boolean("morning").notNull().default(true),
  nightly: boolean("nightly").notNull().default(true),
  events: boolean("events").notNull().default(true),
});

/** Every push the server sent (one row per notice pushed, however many devices). The cap counts these per local day. */
export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userIdCol(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    kind: text("kind").notNull(),
    sentAt: ts("sent_at").defaultNow().notNull(),
  },
  (t) => [index("notification_log_user_date_idx").on(t.userId, t.localDate), index("notification_log_sent_at_idx").on(t.sentAt)],
);

/** The dispatch decision for a push-kind notice (sent | dropped | skipped): each notice is decided once, by the worker. */
export const noticePushes = pgTable(
  "notice_pushes",
  {
    noticeId: uuid("notice_id")
      .primaryKey()
      .references(() => notices.id, { onDelete: "cascade" }),
    userId: userIdCol(),
    decision: text("decision").notNull(),
    decidedAt: ts("decided_at").defaultNow().notNull(),
  },
  (t) => [index("notice_pushes_user_idx").on(t.userId), index("notice_pushes_decided_at_idx").on(t.decidedAt)],
);

export type PushToken = typeof pushTokens.$inferSelect;
export type NotificationPrefsRow = typeof notificationPrefs.$inferSelect;
