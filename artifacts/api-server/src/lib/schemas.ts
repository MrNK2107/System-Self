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
  username: z.string().min(1),
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
  username: z.string().min(1),
  rank: z.string().min(1),
  domainScores: domainScoresSchema,
  primaryGoal: z.string().min(1),
  weakestDomain: z.string().min(1),
  recentLogs: z.array(z.string()).default([]),
  shadowGap: z.number().optional(),
  dayNumber: z.number().int().min(1).optional(),
});
