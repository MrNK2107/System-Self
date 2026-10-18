import { and, count, desc, eq, notInArray } from "drizzle-orm";
import { systemMessages } from "@workspace/db";
import type { PromptContext, GeneratedMessage } from "./ai-context";
import type { HandlerResult } from "./idempotency";
import type { Tx } from "./user-lock";

/** Generated once per user per local day; asking again returns the stored text. nightly_debrief is served from the debriefs row instead. */
export const CACHED_PER_DAY: ReadonlySet<string> = new Set(["morning_briefing", "weekly_debrief"]);
/** Other message types are capped per user per local day, since each one costs a model call. */
export const UNCACHED_DAILY_LIMIT = 20;

type MessageRow = typeof systemMessages.$inferSelect;

export function messageResult(row: Pick<MessageRow, "message" | "promptVersion" | "model" | "attempts">): HandlerResult {
  return {
    status: 200,
    body: { message: row.message, meta: { promptVersion: row.promptVersion, model: row.model, attempts: row.attempts } },
  };
}

export async function cachedMessage(tx: Pick<Tx, "select">, userId: string, type: string, today: string) {
  const [row] = await tx
    .select()
    .from(systemMessages)
    .where(and(eq(systemMessages.userId, userId), eq(systemMessages.messageType, type), eq(systemMessages.localDate, today)))
    .orderBy(desc(systemMessages.id))
    .limit(1);
  return row;
}

/** True when the user has used up today's allowance of uncached messages. */
export async function overMessageLimit(tx: Pick<Tx, "select">, userId: string, today: string): Promise<boolean> {
  const [row] = await tx
    .select({ n: count() })
    .from(systemMessages)
    .where(
      and(
        eq(systemMessages.userId, userId),
        eq(systemMessages.localDate, today),
        notInArray(systemMessages.messageType, [...CACHED_PER_DAY]),
      ),
    );
  return (row?.n ?? 0) >= UNCACHED_DAILY_LIMIT;
}

export const MESSAGE_LIMIT_RESULT: HandlerResult = {
  status: 429,
  body: { error: "Daily message limit reached", code: "message_limit" },
};

export async function storeMessage(
  tx: Pick<Tx, "insert">,
  userId: string,
  type: string,
  ctx: PromptContext,
  generated: GeneratedMessage,
  extraContext?: string,
): Promise<void> {
  await tx.insert(systemMessages).values({
    userId,
    messageType: type,
    rank: ctx.rank,
    trajectory: ctx.trajectory,
    shadowActive: ctx.shadowActive,
    shadowGap: Math.round(ctx.shadowGap),
    dayNumber: ctx.dayNumber,
    message: generated.message,
    model: generated.model,
    promptVersion: generated.promptVersion,
    attempts: generated.attempts,
    localDate: ctx.today,
    context: {
      scores: ctx.scores,
      activeQuests: ctx.activeQuests,
      completedToday: ctx.completedToday,
      weakestDomain: ctx.weakestDomain,
      primaryGoal: ctx.primaryGoal,
      extraContext: extraContext ?? null,
    },
  });
}
