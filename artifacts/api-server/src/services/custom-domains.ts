import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { customDomains, customLogs, users, type CustomDomainRow, type CustomLogRow, type Db } from "@workspace/db";
import { CUSTOM_LIMIT_FREE, CUSTOM_LIMIT_PRO, customStreakNow, localDate } from "@workspace/engine";
import type { CustomDomainDto, CustomLogDto, PublicCustomDomain } from "@workspace/contracts";

type Reader = Pick<Db, "select" | "selectDistinctOn">;

/** The most active custom domains a user may hold at once. */
export const customLimit = (isPro: boolean) => (isPro ? CUSTOM_LIMIT_PRO : CUSTOM_LIMIT_FREE);

/** Active (non-archived) custom domains of the user. */
export async function activeCustomCount(tx: Reader, userId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(customDomains)
    .where(and(eq(customDomains.userId, userId), isNull(customDomains.archivedAt)));
  return row?.n ?? 0;
}

export async function userToday(tx: Reader, userId: string, now: Date): Promise<string> {
  const [u] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
  return localDate(now, u?.tz ?? "UTC");
}

/** The most recent value logged per domain (by when it happened); domains without a log are absent. */
export async function latestValues(tx: Reader, domainIds: readonly string[]): Promise<Map<string, number>> {
  if (domainIds.length === 0) return new Map();
  const rows = await tx
    .selectDistinctOn([customLogs.customDomainId], { id: customLogs.customDomainId, value: customLogs.value })
    .from(customLogs)
    .where(inArray(customLogs.customDomainId, [...domainIds]))
    .orderBy(customLogs.customDomainId, desc(customLogs.occurredAt), desc(customLogs.id));
  return new Map(rows.map((r) => [r.id, r.value]));
}

export function toCustomDomainDto(row: CustomDomainRow, latest: number | null, today: string): CustomDomainDto {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    logLabel: row.logLabel,
    baseline: row.baseline,
    target: row.target,
    isPublic: row.isPublic,
    archived: row.archivedAt !== null,
    score: row.score,
    streak: customStreakNow(row.streak, row.lastLogDate, today),
    lastLogDate: row.lastLogDate,
    latestValue: latest,
  };
}

export function toCustomLogDto(l: CustomLogRow): CustomLogDto {
  return {
    id: l.id,
    clientId: l.clientId,
    value: l.value,
    note: l.note,
    occurredAt: l.occurredAt.toISOString(),
    localDate: l.localDate,
  };
}

export const RECENT_CUSTOM_LOGS = 30;

/** The domain with its newest logs, in the contract shape. */
export async function customDomainDetail(tx: Reader, row: CustomDomainRow, now: Date) {
  const [latest, logs, today] = await Promise.all([
    latestValues(tx, [row.id]),
    tx
      .select()
      .from(customLogs)
      .where(eq(customLogs.customDomainId, row.id))
      .orderBy(desc(customLogs.occurredAt), desc(customLogs.id))
      .limit(RECENT_CUSTOM_LOGS),
    userToday(tx, row.userId, now),
  ]);
  return { domain: toCustomDomainDto(row, latest.get(row.id) ?? null, today), logs: logs.map(toCustomLogDto) };
}

/**
 * The public custom domains of each user (isPublic and not archived) as another player may see them: name and score
 * only, oldest first. Users without any are absent. The one query projection reads; nothing private is selected.
 */
export async function loadPublicCustomDomains(tx: Pick<Db, "select">, userIds: readonly string[]): Promise<Map<string, PublicCustomDomain[]>> {
  const out = new Map<string, PublicCustomDomain[]>();
  if (userIds.length === 0) return out;
  const rows = await tx
    .select({ userId: customDomains.userId, name: customDomains.name, score: customDomains.score })
    .from(customDomains)
    .where(and(inArray(customDomains.userId, [...userIds]), eq(customDomains.isPublic, true), isNull(customDomains.archivedAt)))
    .orderBy(asc(customDomains.createdAt), asc(customDomains.id));
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    list.push({ name: r.name, score: r.score });
    out.set(r.userId, list);
  }
  return out;
}
