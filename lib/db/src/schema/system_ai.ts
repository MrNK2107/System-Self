import { boolean, date, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { users } from "./users";

const userIdCol = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

export const systemMessages = pgTable("system_messages", {
  id: serial("id").primaryKey(),
  userId: userIdCol(),
  messageType: text("message_type").notNull(),
  rank: text("rank").notNull(),
  trajectory: text("trajectory").notNull(),
  shadowActive: boolean("shadow_active").notNull(),
  shadowGap: integer("shadow_gap").notNull(),
  dayNumber: integer("day_number").notNull(),
  message: text("message").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  attempts: integer("attempts").notNull(),
  context: jsonb("context"),
  localDate: date("local_date", { mode: "string" }), // user's local day; null on rows from before server-built messages
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("system_messages_user_created_idx").on(t.userId, t.createdAt),
  index("system_messages_user_local_date_idx").on(t.userId, t.localDate),
]);

export const generatedQuestBatches = pgTable("generated_quest_batches", {
  id: serial("id").primaryKey(),
  userId: userIdCol(),
  rank: text("rank").notNull(),
  weakestDomain: text("weakest_domain").notNull(),
  primaryGoal: text("primary_goal").notNull(),
  dayNumber: integer("day_number").notNull(),
  shadowGap: integer("shadow_gap").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  attempts: integer("attempts").notNull(),
  localDate: date("local_date", { mode: "string" }), // user's local day the batch was generated for
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("generated_quest_batches_user_created_idx").on(t.userId, t.createdAt),
  index("generated_quest_batches_user_local_date_idx").on(t.userId, t.localDate),
]);

export const generatedQuests = pgTable("generated_quests", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id")
    .notNull()
    .references(() => generatedQuestBatches.id, { onDelete: "cascade" }),
  userId: userIdCol(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  domain: text("domain").notNull(),
  type: text("type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("generated_quests_user_created_domain_idx").on(t.userId, t.createdAt, t.domain)]);

export const questCompletionEvents = pgTable(
  "quest_completion_events",
  {
    id: serial("id").primaryKey(),
    userId: userIdCol(),
    questId: text("quest_id").notNull(),
    status: text("status").notNull(),
    domain: text("domain").notNull(),
    questType: text("quest_type").notNull(),
    idempotencyKey: text("idempotency_key"),
    completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
    source: text("source").notNull().default("app"),
  },
  (t) => [
    uniqueIndex("quest_completion_events_user_idempotency_key_unique").on(t.userId, t.idempotencyKey),
    index("quest_completion_events_user_completed_status_domain_idx").on(
      t.userId,
      t.completedAt,
      t.status,
      t.domain,
    ),
  ],
);

export const insertSystemMessageSchema = createInsertSchema(systemMessages).omit({
  id: true,
  createdAt: true,
});
export const insertGeneratedQuestBatchSchema = createInsertSchema(generatedQuestBatches).omit({
  id: true,
  createdAt: true,
});
export const insertGeneratedQuestSchema = createInsertSchema(generatedQuests).omit({
  id: true,
  createdAt: true,
});
export const insertQuestCompletionEventSchema = createInsertSchema(questCompletionEvents).omit({
  id: true,
});

export type SystemMessage = typeof systemMessages.$inferSelect;
export type InsertSystemMessage = z.infer<typeof insertSystemMessageSchema>;
export type GeneratedQuestBatch = typeof generatedQuestBatches.$inferSelect;
export type InsertGeneratedQuestBatch = z.infer<typeof insertGeneratedQuestBatchSchema>;
export type GeneratedQuest = typeof generatedQuests.$inferSelect;
export type InsertGeneratedQuest = z.infer<typeof insertGeneratedQuestSchema>;
export type QuestCompletionEvent = typeof questCompletionEvents.$inferSelect;
export type InsertQuestCompletionEvent = z.infer<typeof insertQuestCompletionEventSchema>;
