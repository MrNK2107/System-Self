import { check, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * One row per user who ever held a tier. `source` is `admin` (grant endpoint) or `revenuecat` (webhook).
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
    /** RevenueCat product id of the last applied purchase event (null for admin grants). */
    productId: text("product_id"),
    /** RevenueCat period type (NORMAL, TRIAL, INTRO, ...) of the last applied purchase event. */
    periodType: text("period_type"),
    /** `event_timestamp_ms` of the newest RevenueCat event applied; older events are recorded and ignored. */
    latestEventAt: timestamp("latest_event_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("entitlements_tier_valid", sql`${t.tier} in ('free', 'pro')`),
    check("entitlements_source_valid", sql`${t.source} in ('admin', 'revenuecat')`),
  ],
);

export type Entitlement = typeof entitlements.$inferSelect;

/** Every RevenueCat webhook delivery, keyed by RevenueCat's event id so a replay is a no-op. Ignored events are kept too. */
export const billingEvents = pgTable("billing_events", {
  id: text("id").primaryKey(),
  /** Null when `app_user_id` is not a known user. */
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
});

export type BillingEvent = typeof billingEvents.$inferSelect;
