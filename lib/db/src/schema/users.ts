import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
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
});

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
  (t) => [index("refresh_tokens_user_id_idx").on(t.userId), index("refresh_tokens_family_id_idx").on(t.familyId)],
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
  (t) => [index("email_codes_user_purpose_idx").on(t.userId, t.purpose)],
);

export type User = typeof users.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type EmailCode = typeof emailCodes.$inferSelect;
