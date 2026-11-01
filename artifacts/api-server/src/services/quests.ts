import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { inferQuestSpec, localDate, localTimeToInstant, type QuestTarget } from "@workspace/engine";
import { questChains, questProofs, quests, scoreEvents } from "@workspace/db";
import type { Tx } from "./user-lock";

export interface NewQuest {
  type: "daily" | "weekly" | "arc";
  title: string;
  description: string;
  domain: string;
  expiresAt: Date;
  batchId?: number;
  chainId?: string;
  chainStep?: number;
  chainTotal?: number;
  /** PRO bonus daily (no rank effect). */
  bonus?: boolean;
}

/** Inserts quests for a user and returns the created rows (in input order). */
export async function createQuests(tx: Pick<Tx, "insert">, userId: string, items: NewQuest[]) {
  if (items.length === 0) return [];
  return tx
    .insert(quests)
    .values(
      items.map((i) => ({
        ...inferQuestSpec(i),
        userId,
        type: i.type,
        title: i.title,
        description: i.description,
        domain: i.domain,
        expiresAt: i.expiresAt,
        batchId: i.batchId ?? null,
        chainId: i.chainId ?? null,
        chainStep: i.chainStep ?? null,
        chainTotal: i.chainTotal ?? null,
        bonus: i.bonus ?? false,
      })),
    )
    .returning();
}

/**
 * SQL: the quest counts toward ranking (completion rate, rank windows, adherence, clan/raid stats, achievements).
 * Every ranking consumer of the quests table must carry this; bonus quests are excluded everywhere.
 */
export const countsForRank = eq(quests.bonus, false);

export type SlotState = "none" | "upcoming" | "open" | "missed";

/** Where `now` sits against a quest's locked slot (today's local HH:MM window). */
export function slotStateOf(q: { slotStart: string | null; slotEnd: string | null }, now: Date, tz: string): SlotState {
  if (!q.slotStart || !q.slotEnd) return "none";
  const day = localDate(now, tz);
  const at = (hhmm: string) => localTimeToInstant(day, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)), tz).getTime();
  const t = now.getTime();
  if (t < at(q.slotStart)) return "upcoming";
  return t <= at(q.slotEnd) ? "open" : "missed";
}

export function toQuestDto(q: typeof quests.$inferSelect, slotState: SlotState = "none") {
  return {
    id: q.id,
    type: q.type as "daily" | "weekly" | "arc",
    title: q.title,
    description: q.description,
    domain: q.domain,
    status: q.status as "active" | "complete" | "failed" | "refused",
    expiresAt: q.expiresAt.toISOString(),
    resolvedAt: q.resolvedAt ? q.resolvedAt.toISOString() : null,
    chainId: q.chainId,
    chainStep: q.chainStep,
    chainTotal: q.chainTotal,
    refusalReason: q.refusalReason,
    slotStart: q.slotStart,
    slotEnd: q.slotEnd,
    shameMode: q.shameMode,
    bonus: q.bonus,
    slotState,
    difficulty: (q.difficulty ?? "normal") as "easy" | "normal" | "hard",
    target: (q.target ?? null) as QuestTarget | null,
    createdAt: q.createdAt.toISOString(),
  };
}

/** Marks an active chain abandoned (its quest was refused or failed), freeing the template to start again. */
export async function abandonChain(tx: Pick<Tx, "update">, chainId: string): Promise<void> {
  await tx
    .update(questChains)
    .set({ status: "abandoned" })
    .where(and(eq(questChains.id, chainId), eq(questChains.status, "active")));
}

/** Active, unexpired quests, soonest expiry first (same order as GET /quests). */
export async function activeBoard(tx: Pick<Tx, "select">, userId: string, now: Date) {
  return tx
    .select()
    .from(quests)
    .where(and(eq(quests.userId, userId), eq(quests.status, "active"), gt(quests.expiresAt, now)))
    .orderBy(asc(quests.expiresAt), asc(quests.createdAt));
}

export async function hasActiveChain(tx: Pick<Tx, "select">, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: questChains.id })
    .from(questChains)
    .where(and(eq(questChains.userId, userId), eq(questChains.status, "active")))
    .limit(1);
  return Boolean(row);
}

/**
 * True when today just became a clean day: no non-bonus daily quest is still open or was failed/refused today, and the
 * clean-day bonus has not been given yet today. Call after the completing quest is marked complete.
 */
export async function isCleanDay(tx: Pick<Tx, "select">, userId: string, today: string, now: Date): Promise<boolean> {
  const dailies = and(eq(quests.userId, userId), eq(quests.type, "daily"), eq(quests.bonus, false));
  const open = await tx
    .select({ id: quests.id })
    .from(quests)
    .where(and(dailies, eq(quests.status, "active"), gt(quests.expiresAt, now)))
    .limit(1);
  if (open.length > 0) return false;
  const missed = await tx
    .select({ id: quests.id })
    .from(quests)
    .where(and(dailies, inArray(quests.status, ["failed", "refused"]), eq(quests.resolvedLocalDate, today)))
    .limit(1);
  if (missed.length > 0) return false;
  const given = await tx
    .select({ id: scoreEvents.id })
    .from(scoreEvents)
    .where(and(eq(scoreEvents.userId, userId), eq(scoreEvents.reason, "clean_day"), eq(scoreEvents.localDate, today)))
    .limit(1);
  return given.length === 0;
}

/** How long an answer waiting for AI grading holds its quest open past its deadline (spec 8.5.4). */
export const REVIEW_GRACE_MS = 24 * 3600_000;

/** True while the quest has an answer waiting for AI grading from the last 24 h: rollover must not fail it yet. */
export async function hasPendingReview(tx: Pick<Tx, "select">, questId: string, now: Date): Promise<boolean> {
  const rows = await tx
    .select({ id: questProofs.id })
    .from(questProofs)
    .where(
      and(
        eq(questProofs.questId, questId),
        eq(questProofs.status, "awaiting_review"),
        gt(questProofs.createdAt, new Date(now.getTime() - REVIEW_GRACE_MS)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
