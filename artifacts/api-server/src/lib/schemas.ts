import { z } from "zod";
import { RANKED_DOMAINS } from "@workspace/engine";

const clientIdSchema = z.string().min(1).max(200);

export const MESSAGE_TYPES = [
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
  "weekly_debrief",
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** The server builds all context itself; the client only names the message and may add a short note. */
export const systemMessageRequestSchema = z.object({
  type: z.enum(MESSAGE_TYPES),
  extraContext: z.string().max(500).optional(),
  clientId: clientIdSchema.optional(),
});

export const generateQuestsRequestSchema = z.object({ clientId: clientIdSchema.optional() });

export const aiMetaSchema = z.object({
  promptVersion: z.string().min(1),
  model: z.string().min(1),
  attempts: z.number().int().min(1),
});

export const systemMessageResponseSchema = z.object({
  message: z.string().min(1),
  meta: aiMetaSchema,
});

export const generatedQuestSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(400),
  domain: z.enum(RANKED_DOMAINS),
  type: z.enum(["daily", "weekly", "arc"]),
});

/** The JSON a model must return for quest generation. */
export const generatedQuestsPayloadSchema = z.object({
  quests: z.array(generatedQuestSchema).min(1),
});

export const generateQuestsResponseSchema = generatedQuestsPayloadSchema.extend({ meta: aiMetaSchema });

export const questCompletionEventBodySchema = z.object({
  questId: z.string().min(1),
  status: z.enum(["complete", "failed", "refused"]),
  domain: z.enum(["BODY", "MIND", "WEALTH", "DISCIPLINE"]),
  questType: z.enum(["daily", "weekly", "arc"]),
  idempotencyKey: z.string().min(8).max(200).optional(),
  completedAt: z.string().datetime().optional(),
  source: z.string().default("app"),
});
