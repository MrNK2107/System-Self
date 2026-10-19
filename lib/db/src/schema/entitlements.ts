import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * One row per user who ever held a tier. `source` is `admin` until P7 adds RevenueCat webhooks (`revenuecat`).
 * A missing row means free. A pro row with a past `expiresAt` is expired (free).
 */
export const entitlements = pgTable(
  "entitlements",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    tier: text("tier").notNull(),
    source: text("source").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("entitlements_tier_valid", sql`${t.tier} in ('free', 'pro')`),
    check("entitlements_source_valid", sql`${t.source} in ('admin', 'revenuecat')`),
  ],
);

export type Entitlement = typeof entitlements.$inferSelect;
