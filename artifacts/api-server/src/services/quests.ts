import { and, asc, eq, gt } from "drizzle-orm";
import { localDate, localTimeToInstant } from "@workspace/engine";
import { questChains, quests } from "@workspace/db";
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
}

/** Inserts quests for a user and returns the created rows (in input order). */
export async function createQuests(tx: Pick<Tx, "insert">, userId: string, items: NewQuest[]) {
  if (items.length === 0) return [];
  return tx
    .insert(quests)
    .values(
      items.map((i) => ({
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
      })),
    )
    .returning();
}

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
    slotState,
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
