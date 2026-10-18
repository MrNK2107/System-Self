import { z } from "zod";
import { RANKED_DOMAINS } from "@workspace/engine";
import { AiMetaSchema } from "@workspace/contracts";

const clientIdSchema = z.string().min(1).max(200);

export const generateQuestsRequestSchema = z.object({ clientId: clientIdSchema.optional() });

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

export const generateQuestsResponseSchema = generatedQuestsPayloadSchema.extend({ meta: AiMetaSchema });

export const questCompletionEventBodySchema = z.object({
  questId: z.string().min(1),
  status: z.enum(["complete", "failed", "refused"]),
  domain: z.enum(RANKED_DOMAINS),
  questType: z.enum(["daily", "weekly", "arc"]),
  idempotencyKey: z.string().min(8).max(200).optional(),
  completedAt: z.string().datetime().optional(),
  source: z.string().default("app"),
});
