import { z } from "zod";

const domainScoresSchema = z.object({
  BODY: z.number(),
  MIND: z.number(),
  WEALTH: z.number(),
  DISCIPLINE: z.number(),
});

export const generateSystemMessageBodySchema = z.object({
  messageType: z.enum([
    "morning_briefing",
    "nightly_debrief",
    "quest_assignment",
    "rank_change",
    "shadow_self",
    "milestone",
    "failure_response",
    "streak_break",
    "shadow_confrontation",
    "rival_taunt",
    "chain_complete",
    "domain_milestone",
    "forbidden_log",
    "rank_up_prep",
  ]),
  rank: z.string().min(1),
  domainScores: domainScoresSchema,
  trajectory: z.enum(["up", "stable", "down"]),
  shadowActive: z.boolean(),
  shadowGap: z.number(),
  questCount: z.number().int().min(0),
  completedQuestCount: z.number().int().min(0),
  primaryGoal: z.string().min(1),
  dayNumber: z.number().int().min(1),
  rivalMovement: z.string().nullish(),
  extraContext: z.string().nullish(),
});

export const generateQuestsBodySchema = z.object({
  rank: z.string().min(1),
  domainScores: domainScoresSchema,
  primaryGoal: z.string().min(1),
  weakestDomain: z.string().min(1),
  recentLogs: z.array(z.string()).default([]),
  shadowGap: z.number().optional(),
  dayNumber: z.number().int().min(1).optional(),
});

export const generateSystemMessageResponseSchema = z.object({
  message: z.string().min(1),
  messageType: z.string().min(1),
  meta: z.object({
    promptVersion: z.string().min(1),
    model: z.string().min(1),
    attempts: z.number().int().min(1),
  }),
});

export const generatedQuestSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  domain: z.enum(["BODY", "MIND", "WEALTH", "DISCIPLINE"]),
  type: z.enum(["daily", "weekly", "arc"]),
});

export const generateQuestsResponseSchema = z.object({
  quests: z.array(generatedQuestSchema).min(1),
  meta: z.object({
    promptVersion: z.string().min(1),
    model: z.string().min(1),
    attempts: z.number().int().min(1),
  }),
});

export const questCompletionEventBodySchema = z.object({
  questId: z.string().min(1),
  status: z.enum(["complete", "failed", "refused"]),
  domain: z.enum(["BODY", "MIND", "WEALTH", "DISCIPLINE"]),
  questType: z.enum(["daily", "weekly", "arc"]),
  idempotencyKey: z.string().min(8).max(200).optional(),
  completedAt: z.string().datetime().optional(),
  source: z.string().default("app"),
});
