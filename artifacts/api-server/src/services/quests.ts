import { and, eq } from "drizzle-orm";
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

export function toQuestDto(q: typeof quests.$inferSelect) {
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
