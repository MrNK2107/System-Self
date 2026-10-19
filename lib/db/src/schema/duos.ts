import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * A Party of Two (duo): exactly two players. One duo per user is enforced by `duo_members(user_id pk)`, so two
 * concurrent accepts can never put a user in two duos. Deleting either account removes the duo (and its check-ins).
 */
export const duos = pgTable(
  "duos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userA: uuid("user_a")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userB: uuid("user_b")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [check("duos_distinct", sql`${t.userA} <> ${t.userB}`)],
);

export const duoMembers = pgTable(
  "duo_members",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
  },
  (t) => [index("duo_members_duo_idx").on(t.duoId)],
);

/** An invite by username. `pending` until the invitee accepts or declines (or either joins another duo: `cancelled`). */
export const duoInvites = pgTable(
  "duo_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromId: uuid("from_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toId: uuid("to_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").defaultNow().notNull(),
    status: text("status").notNull().default("pending"),
  },
  (t) => [
    index("duo_invites_to_idx").on(t.toId, t.status),
    index("duo_invites_from_idx").on(t.fromId, t.status),
    // One open invite per ordered pair.
    uniqueIndex("duo_invites_pending_uq").on(t.fromId, t.toId).where(sql`${t.status} = 'pending'`),
    check("duo_invites_status_valid", sql`${t.status} in ('pending', 'accepted', 'declined', 'cancelled')`),
    check("duo_invites_distinct", sql`${t.fromId} <> ${t.toId}`),
  ],
);

/** A check-in shown to the partner. No score effect, ever. */
export const duoCheckins = pgTable(
  "duo_checkins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("duo_checkins_duo_created_idx").on(t.duoId, t.createdAt.desc()),
    index("duo_checkins_user_created_idx").on(t.userId, t.createdAt.desc()),
    check("duo_checkins_kind_valid", sql`${t.kind} in ('going_now', 'checked_in', 'done')`),
  ],
);

export type Duo = typeof duos.$inferSelect;
export type DuoInvite = typeof duoInvites.$inferSelect;
export type DuoCheckin = typeof duoCheckins.$inferSelect;
