import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const systemMessages = pgTable("system_messages", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const generatedQuestBatches = pgTable("generated_quest_batches", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  rank: text("rank").notNull(),
  weakestDomain: text("weakest_domain").notNull(),
  primaryGoal: text("primary_goal").notNull(),
  dayNumber: integer("day_number").notNull(),
  shadowGap: integer("shadow_gap").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  attempts: integer("attempts").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const generatedQuests = pgTable("generated_quests", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id")
    .notNull()
    .references(() => generatedQuestBatches.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  domain: text("domain").notNull(),
  type: text("type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const questCompletionEvents = pgTable("quest_completion_events", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  questId: text("quest_id").notNull(),
  status: text("status").notNull(),
  domain: text("domain").notNull(),
  questType: text("quest_type").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
  source: text("source").notNull().default("app"),
});

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
