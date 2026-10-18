import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The app stores emails lowercased; users_email_lower_idx also enforces case-insensitive uniqueness.
    // The plain unique constraint stays as the index for exact-match lookups (login, forgot).
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    username: text("username").notNull().unique(),
    role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
    emailVerifiedAt: ts("email_verified_at"),
    birthYear: integer("birth_year").notNull(),
    termsAcceptedAt: ts("terms_accepted_at").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    tokenVersion: integer("token_version").notNull().default(0),
    createdAt: ts("created_at").defaultNow().notNull(),
    updatedAt: ts("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    revokedReason: text("revoked_reason", { enum: ["rotated", "superseded", "reused", "logout", "revoked_all"] }),
    replacedById: uuid("replaced_by_id"),
    userAgent: text("user_agent"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("refresh_tokens_user_id_idx").on(t.userId),
    index("refresh_tokens_family_id_idx").on(t.familyId),
    index("refresh_tokens_expires_at_idx").on(t.expiresAt),
  ],
);

export const emailCodes = pgTable(
  "email_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: ["verify", "reset"] }).notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("email_codes_user_purpose_idx").on(t.userId, t.purpose),
    index("email_codes_expires_at_idx").on(t.expiresAt),
  ],
);

export type User = typeof users.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type EmailCode = typeof emailCodes.$inferSelect;
