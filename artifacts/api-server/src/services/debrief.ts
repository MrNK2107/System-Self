import { and, desc, eq, lte } from "drizzle-orm";
import { dailySnapshots, debriefs, domainScores, profiles, quests, users, type Db } from "@workspace/db";
import { RANKED_DOMAINS, debriefVerdict, localDate, localTimeToInstant, type RankedDomain } from "@workspace/engine";
import type { AiDeps } from "../lib/ai";
import { buildUserContext, generateMessage, type DebriefFacts, type PromptContext } from "./ai-context";
import { financeVerdictFor, markVerdictQuoted } from "./finance";
import { rollOverDue } from "./rollover";
import { withUserLock } from "./user-lock";
import { countsForRank } from "./quests";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The instant today's debrief opens: local wall-clock `nightlyTime` (HH:MM) on `today`, DST-safe. */
export function debriefAvailableAt(nightlyTime: string, today: string, tz: string): Date {
  const [h, m] = nightlyTime.split(":").map(Number);
  return localTimeToInstant(today, h ?? 0, m ?? 0, tz);
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
    .where(and(eq(quests.userId, userId), countsForRank, eq(quests.resolvedLocalDate, today)));
  const questCompleted = resolved.filter((q) => q.status === "complete").length;
  const questTotal = resolved.length;
  const verdict = debriefVerdict(deltas, questTotal > 0 ? questCompleted / questTotal : 0);
  const finance = await financeVerdictFor(tx, userId, today);
  return { deltas, questCompleted, questTotal, verdict, financeVerdict: finance?.line ?? null, financeWeekKey: finance?.weekKey ?? null };
}

export function templateDebriefText(ctx: PromptContext, facts: DebriefFacts): string {
  const deltas = RANKED_DOMAINS.map((d) => `${d} ${facts.deltas[d] >= 0 ? "+" : ""}${facts.deltas[d]}`).join(", ");
  const verdict = facts.verdict.charAt(0) + facts.verdict.slice(1).toLowerCase();
  return `Day ${ctx.dayNumber} closed at rank ${ctx.rank}. ${deltas}. Quests resolved: ${facts.questCompleted} of ${facts.questTotal} completed. ${verdict}.${facts.financeVerdict ? ` ${facts.financeVerdict}` : ""}`;
}

export type DebriefOutcome =
  | { kind: "not_onboarded" }
  | { kind: "unavailable"; availableAt: Date }
  | { kind: "ready"; row: typeof debriefs.$inferSelect };

type Step1 = DebriefOutcome | { kind: "build"; today: string; ctx: PromptContext; facts: DebriefFacts };

/**
 * Today's debrief, built once per local day and stored. Three steps so the model call never holds the user lock:
 * (1) under the lock: roll over, check availability, return the stored debrief or gather the facts;
 * (2) lock released: call the model; (3) under the lock again: insert (a concurrent request may have won,
 * so conflicts are ignored) and return whatever is stored.
 */
export async function getOrBuildDebrief(db: Db, userId: string, now: Date, ai: AiDeps): Promise<DebriefOutcome> {
  const step1 = await withUserLock(db, userId, async (tx): Promise<Step1> => {
    await rollOverDue(tx, userId, now);
    const [row] = await tx
      .select({ tz: users.timezone, nightly: profiles.nightlyTime })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return { kind: "not_onboarded" };
    const today = localDate(now, row.tz);
    const availableAt = debriefAvailableAt(row.nightly, today, row.tz);
    if (now.getTime() < availableAt.getTime()) return { kind: "unavailable", availableAt };
    const [existing] = await tx
      .select()
      .from(debriefs)
      .where(and(eq(debriefs.userId, userId), eq(debriefs.localDate, today)))
      .limit(1);
    if (existing) return { kind: "ready", row: existing };
    const ctx = await buildUserContext(tx, userId, now);
    if (!ctx) return { kind: "not_onboarded" };
    return { kind: "build", today, ctx, facts: await computeDebriefFacts(tx, userId, today) };
  });
  if (step1.kind !== "build") return step1;

  const { today, ctx, facts } = step1;
  const generated = await generateMessage("nightly_debrief", ctx, ai, { debrief: facts }, templateDebriefText(ctx, facts));
  const row = await withUserLock(db, userId, async (tx) => {
    const inserted = await tx
      .insert(debriefs)
      .values({
        userId,
        localDate: today,
        deltas: facts.deltas,
        questCompleted: facts.questCompleted,
        questTotal: facts.questTotal,
        verdict: facts.verdict,
        text: generated.message,
        model: generated.model,
      })
      .onConflictDoNothing()
      .returning({ localDate: debriefs.localDate });
    // The debrief that stores the finance verdict marks that week quoted, so no later debrief repeats it.
    if (inserted.length > 0 && facts.financeWeekKey) await markVerdictQuoted(tx, userId, facts.financeWeekKey, now);
    const [stored] = await tx
      .select()
      .from(debriefs)
      .where(and(eq(debriefs.userId, userId), eq(debriefs.localDate, today)))
      .limit(1);
    return stored!;
  });
  return { kind: "ready", row };
}
