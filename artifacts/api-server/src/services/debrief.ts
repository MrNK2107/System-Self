import { and, desc, eq, lte } from "drizzle-orm";
import { dailySnapshots, domainScores, quests, type Db } from "@workspace/db";
import { RANKED_DOMAINS, addDays, debriefVerdict, endOfLocalDay, type RankedDomain } from "@workspace/engine";
import type { DebriefFacts, PromptContext } from "./ai-context";

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The instant today's debrief opens: `nightlyTime` (HH:MM) after the local midnight that starts `today`.
 * Computed as an offset from that midnight, so on a DST-change day it can be an hour off the wall clock.
 */
export function debriefAvailableAt(nightlyTime: string, today: string, tz: string): Date {
  const [h, m] = nightlyTime.split(":").map(Number);
  const startOfToday = endOfLocalDay(addDays(today, -1), tz);
  return new Date(startOfToday.getTime() + ((h ?? 0) * 60 + (m ?? 0)) * 60_000);
}

/**
 * Deltas = current scores minus the start-of-day snapshot. The rollover writes a day's snapshot at its end,
 * so the start of today is yesterday's snapshot; on the onboarding day it is the onboarding snapshot.
 * Quest rate = quests resolved today that were completed / all quests resolved today.
 */
export async function computeDebriefFacts(tx: Pick<Db, "select">, userId: string, today: string): Promise<DebriefFacts> {
  const [snap] = await tx
    .select({ scores: dailySnapshots.scores })
    .from(dailySnapshots)
    .where(and(eq(dailySnapshots.userId, userId), lte(dailySnapshots.localDate, today)))
    .orderBy(desc(dailySnapshots.localDate))
    .limit(1);
  const rows = await tx.select().from(domainScores).where(eq(domainScores.userId, userId));
  const current = new Map(rows.map((r) => [r.domain, r.score]));
  const start = (snap?.scores ?? {}) as Partial<Record<RankedDomain, number>>;
  const deltas = Object.fromEntries(
    RANKED_DOMAINS.map((d) => {
      const now = current.get(d) ?? 0;
      return [d, round1(now - (start[d] ?? now))];
    }),
  ) as Record<RankedDomain, number>;

  const resolved = await tx
    .select({ status: quests.status })
    .from(quests)
    .where(and(eq(quests.userId, userId), eq(quests.resolvedLocalDate, today)));
  const questCompleted = resolved.filter((q) => q.status === "complete").length;
  const questTotal = resolved.length;
  const verdict = debriefVerdict(deltas, questTotal > 0 ? questCompleted / questTotal : 0);
  return { deltas, questCompleted, questTotal, verdict };
}

export function templateDebriefText(ctx: PromptContext, facts: DebriefFacts): string {
  const deltas = RANKED_DOMAINS.map((d) => `${d} ${facts.deltas[d] >= 0 ? "+" : ""}${facts.deltas[d]}`).join(", ");
  const verdict = facts.verdict.charAt(0) + facts.verdict.slice(1).toLowerCase();
  return `Day ${ctx.dayNumber} closed at rank ${ctx.rank}. ${deltas}. Quests resolved: ${facts.questCompleted} of ${facts.questTotal} completed. ${verdict}.`;
}
