// Clans (PRD 15): membership, status, activity, clan score. Membership changes lock the clan row FOR UPDATE inside
// the request's transaction, so concurrent joins/leaves of one clan serialize (a clan never passes 30 members).
import { randomInt } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { blocks, clanDispatches, clanMembers, clans, domainScores, logs, quests, users, type Clan as ClanRow, type Db } from "@workspace/db";
import {
  CLAN_INACTIVE_DAYS,
  CLAN_MIN_ACTIVE,
  type Clan,
  type ClanDispatch,
  type ClanLeaderboardItem,
  type ClanMember,
  type ClanRole,
  type ClanStatus,
  type ClanSummary,
} from "@workspace/contracts";
import { RANKED_DOMAINS, localDate, type RankedDomain } from "@workspace/engine";
import { loadProjectionSubjects, projectUser } from "./projection";
import { hiddenAndTrajectoryBatch } from "./state";
import type { Tx } from "./user-lock";

type Reader = Pick<Db, "select">;

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;

export function newInviteCode(): string {
  let out = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) out += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  return out;
}

/**
 * SQL: the user in `userIdCol` (timezone in `tzCol`) logged on one of the last CLAN_INACTIVE_DAYS local days
 * (today included). Not active = CLAN_INACTIVE_DAYS consecutive inactive local days: dead weight, excluded from
 * the clan score. The single definition of clan activity, used by the score, the dead-weight job and the routes.
 * Pass table-qualified references (a bare column name would resolve against `logs` inside the subquery).
 */
export function activeSql(userIdCol: unknown, tzCol: unknown, now: Date): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${logs} l where l.user_id = ${userIdCol} and l.local_date >= ((${now.toISOString()}::timestamptz at time zone ${tzCol})::date - ${CLAN_INACTIVE_DAYS - 1}::int))`;
}

/** The clan status for a member count: `active` from 8 members, else `forming`. */
export const statusFor = (memberCount: number): ClanStatus => (memberCount >= CLAN_MIN_ACTIVE ? "active" : "forming");

export async function membershipOf(db: Reader, userId: string) {
  const [m] = await db.select().from(clanMembers).where(eq(clanMembers.userId, userId)).limit(1);
  return m ?? null;
}

/** Locks the clan row for the rest of the transaction (membership changes of one clan serialize on it). */
export async function lockClan(tx: Tx, clanId: string): Promise<ClanRow | null> {
  const [row] = await tx.select().from(clans).where(eq(clans.id, clanId)).for("update");
  return row ?? null;
}

export async function memberCount(db: Reader, clanId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(clanMembers).where(eq(clanMembers.clanId, clanId));
  return row?.n ?? 0;
}

export async function addDispatch(tx: Pick<Db, "insert">, clanId: string, kind: string, text: string, now: Date) {
  await tx.insert(clanDispatches).values({ clanId, kind, text, createdAt: now });
}

/**
 * Re-derives the status from the member count right after a membership change (call with the clan row locked).
 * Dropping below 8 also clears the rank. A status change is announced as a dispatch.
 */
export async function syncClanStatus(tx: Tx, clan: ClanRow, now: Date): Promise<{ count: number; status: ClanStatus }> {
  const n = await memberCount(tx, clan.id);
  const status = statusFor(n);
  if (status !== clan.status) {
    await tx
      .update(clans)
      .set(status === "forming" ? { status, clanRank: null } : { status })
      .where(eq(clans.id, clan.id));
    await addDispatch(
      tx,
      clan.id,
      "status",
      status === "active"
        ? `CLAN ACTIVE. ${n} operators on the roster. Raids and global rank are now in effect.`
        : `CLAN FORMING. Roster at ${n}. ${CLAN_MIN_ACTIVE} operators are required for raids and rank.`,
      now,
    );
  }
  return { count: n, status };
}

/** True when a block exists in either direction between `userId` and any member of the clan. */
export async function blockedWithMember(db: Reader, userId: string, clanId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(clanMembers)
    .where(
      and(
        eq(clanMembers.clanId, clanId),
        sql`exists (select 1 from ${blocks} b where (b.blocker_id = ${userId} and b.blocked_id = ${clanMembers.userId}) or (b.blocker_id = ${clanMembers.userId} and b.blocked_id = ${userId}))`,
      ),
    )
    .limit(1);
  return !!row;
}

/** Whether `userId` is active (a log in the last 5 local days). */
export async function isActive(db: Reader, userId: string, now: Date): Promise<boolean> {
  const [row] = await db
    // Qualified on purpose: in a one-table select drizzle renders bare column names, which the logs subquery would capture.
    .select({ active: activeSql(sql`${users}."id"`, sql`${users}."timezone"`, now) })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return !!row?.active;
}

// --- DTOs ---------------------------------------------------------------------------------------

const counts = (db: Reader, clanIds: string[]) =>
  clanIds.length === 0
    ? Promise.resolve(new Map<string, number>())
    : db
        .select({ clanId: clanMembers.clanId, n: count() })
        .from(clanMembers)
        .where(inArray(clanMembers.clanId, clanIds))
        .groupBy(clanMembers.clanId)
        .then((rows) => new Map(rows.map((r) => [r.clanId, r.n])));

const summary = (c: ClanRow, n: number): ClanSummary => ({
  id: c.id,
  name: c.name,
  tag: c.tag,
  memberCount: n,
  status: c.status as ClanStatus,
  clanRank: c.clanRank,
});

export async function toSummaries(db: Reader, rows: ClanRow[]): Promise<ClanSummary[]> {
  const n = await counts(db, rows.map((r) => r.id));
  return rows.map((r) => summary(r, n.get(r.id) ?? 0));
}

export async function toLeaderboardItems(db: Reader, rows: ClanRow[]): Promise<ClanLeaderboardItem[]> {
  const n = await counts(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...summary(r, n.get(r.id) ?? 0), clanScore: r.clanScore }));
}

export async function toClanDto(db: Reader, c: ClanRow, myRole: ClanRole): Promise<Clan> {
  return {
    ...summary(c, await memberCount(db, c.id)),
    description: c.description,
    clanScore: c.clanScore,
    raidWins: c.raidWins,
    inviteCode: c.inviteCode,
    createdAt: c.createdAt.toISOString(),
    myRole,
  };
}

/**
 * The members as a clanmate sees them: the clanmate projection (usernames always, PRD 16), role, the dead-weight
 * flag (only while still inactive) and the 30-day quest completion %. Leader first, then by join time.
 */
export async function clanMembersView(db: Reader, clanId: string, viewerId: string, now: Date): Promise<ClanMember[]> {
  const rows = await db
    .select({
      userId: clanMembers.userId,
      role: clanMembers.role,
      flaggedAt: clanMembers.flaggedAt,
      active: activeSql(clanMembers.userId, users.timezone, now),
      resolved: sql<number>`(select count(*)::int from ${quests} q where q.user_id = ${clanMembers.userId} and q.status in ('complete', 'failed', 'refused') and q.resolved_local_date >= ((${now.toISOString()}::timestamptz at time zone ${users.timezone})::date - 29))`,
      completed: sql<number>`(select count(*)::int from ${quests} q where q.user_id = ${clanMembers.userId} and q.status = 'complete' and q.resolved_local_date >= ((${now.toISOString()}::timestamptz at time zone ${users.timezone})::date - 29))`,
    })
    .from(clanMembers)
    .innerJoin(users, eq(users.id, clanMembers.userId))
    .where(eq(clanMembers.clanId, clanId))
    .orderBy(sql`case when ${clanMembers.role} = 'leader' then 0 else 1 end`, asc(clanMembers.joinedAt), asc(clanMembers.userId));
  const subjects = await loadProjectionSubjects(db, rows.map((r) => r.userId), now);
  const out: ClanMember[] = [];
  for (const r of rows) {
    const s = subjects.get(r.userId);
    if (!s) continue; // not onboarded: nothing to show yet
    out.push({
      userId: r.userId,
      isSelf: r.userId === viewerId,
      profile: projectUser(s, "clanmate"),
      role: r.role as ClanRole,
      flagged: r.flaggedAt !== null && !r.active,
      questCompletionRate30d: r.resolved > 0 ? Math.round((r.completed / r.resolved) * 100) : null,
    });
  }
  return out;
}

export async function recentDispatches(db: Reader, clanId: string, limit = 10): Promise<ClanDispatch[]> {
  const rows = await db
    .select()
    .from(clanDispatches)
    .where(eq(clanDispatches.clanId, clanId))
    .orderBy(desc(clanDispatches.createdAt), desc(clanDispatches.id))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, createdAt: r.createdAt.toISOString() }));
}

// --- daily jobs ---------------------------------------------------------------------------------

/** `YYYY-MM` of `now` in UTC (the raid bonus month). */
export const utcMonth = (now: Date) => now.toISOString().slice(0, 7);

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Clan score of each clan: the mean hidden score of its active members (inactive ones excluded; 0 with none
 * active) plus the raid bonus accumulated in the current UTC month. Hidden scores stay server-side.
 */
export async function computeClanScores(db: Reader, clanRows: ClanRow[], now: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (clanRows.length === 0) return out;
  const members = await db
    .select({ clanId: clanMembers.clanId, userId: clanMembers.userId, timezone: users.timezone })
    .from(clanMembers)
    .innerJoin(users, eq(users.id, clanMembers.userId))
    .where(and(inArray(clanMembers.clanId, clanRows.map((c) => c.id)), activeSql(clanMembers.userId, users.timezone, now)));
  const ids = members.map((m) => m.userId);
  const scoreRows = ids.length ? await db.select().from(domainScores).where(inArray(domainScores.userId, ids)) : [];
  const scoreMaps = new Map<string, Record<RankedDomain, number>>();
  for (const id of ids) scoreMaps.set(id, Object.fromEntries(RANKED_DOMAINS.map((d) => [d, 0])) as Record<RankedDomain, number>);
  for (const s of scoreRows) {
    const m = scoreMaps.get(s.userId);
    if (m && s.domain in m) m[s.domain as RankedDomain] = s.score;
  }
  const hidden = await hiddenAndTrajectoryBatch(
    db,
    members.map((m) => ({ userId: m.userId, today: localDate(now, m.timezone), scoreMap: scoreMaps.get(m.userId)! })),
  );
  const month = utcMonth(now);
  for (const c of clanRows) {
    const mine = members.filter((m) => m.clanId === c.id).map((m) => hidden.get(m.userId)!.hidden);
    const mean = mine.length ? mine.reduce((a, b) => a + b, 0) / mine.length : 0;
    out.set(c.id, round2(mean + (c.raidBonusMonth === month ? c.raidBonus : 0)));
  }
  return out;
}

/**
 * Repairs a clan left without a leader (the leader's account was deleted): the longest-standing member leads.
 * Deletes clans left with no members. Returns the ids of deleted clans.
 */
export async function repairClans(db: Db, clanIds: string[]): Promise<Set<string>> {
  const deleted = new Set<string>();
  for (const clanId of clanIds) {
    await db.transaction(async (tx) => {
      const clan = await lockClan(tx, clanId);
      if (!clan) return;
      const rows = await tx
        .select()
        .from(clanMembers)
        .where(eq(clanMembers.clanId, clanId))
        .orderBy(asc(clanMembers.joinedAt), asc(clanMembers.userId));
      if (rows.length === 0) {
        await tx.delete(clans).where(eq(clans.id, clanId));
        deleted.add(clanId);
        return;
      }
      if (!rows.some((r) => r.role === "leader")) {
        await tx.update(clanMembers).set({ role: "leader" }).where(eq(clanMembers.userId, rows[0]!.userId));
      }
      const status = statusFor(rows.length);
      if (status !== clan.status) await tx.update(clans).set(status === "forming" ? { status, clanRank: null } : { status }).where(eq(clans.id, clanId));
    });
  }
  return deleted;
}

/** Global rank by clan score among active clans (ties: older clan first); forming clans are unranked. */
export async function assignClanRanks(db: Pick<Db, "execute">): Promise<void> {
  await db.execute(sql`
    update ${clans} c set clan_rank = r.rk
    from (select id, row_number() over (order by clan_score desc, created_at asc, id asc)::int as rk from ${clans} where status = 'active') r
    where c.id = r.id`);
  await db.execute(sql`update ${clans} set clan_rank = null where status <> 'active' and clan_rank is not null`);
}

/**
 * Flags members with CLAN_INACTIVE_DAYS consecutive inactive local days (keeps an earlier flag time) and clears
 * the flag of members active again. Two set-based statements.
 */
export async function updateDeadWeightFlags(db: Pick<Db, "execute">, now: Date): Promise<{ flagged: number; cleared: number }> {
  const flagged = await db.execute(sql`
    update ${clanMembers} m set flagged_at = ${now.toISOString()}::timestamptz
    from ${users} u
    where u.id = m.user_id and m.flagged_at is null and not ${activeSql(sql`m.user_id`, sql`u.timezone`, now)}`);
  const cleared = await db.execute(sql`
    update ${clanMembers} m set flagged_at = null
    from ${users} u
    where u.id = m.user_id and m.flagged_at is not null and ${activeSql(sql`m.user_id`, sql`u.timezone`, now)}`);
  return { flagged: flagged.rowCount ?? 0, cleared: cleared.rowCount ?? 0 };
}
