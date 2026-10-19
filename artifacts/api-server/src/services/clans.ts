// Clans (PRD 15): membership, status, activity, clan score. Membership changes lock the clan row FOR UPDATE inside
// the request's transaction, so concurrent joins/leaves of one clan serialize (a clan never passes 30 members).
import { randomInt } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { blocks, clanDispatches, clanMembers, clans, domainScores, logs, quests, users, type Clan as ClanRow, type Db } from "@workspace/db";
import {
  CLAN_INACTIVE_DAYS,
  CLAN_MIN_ACTIVE,
  CLAN_SCORE_MIN_ACTIVE,
  FORMER_OPERATOR_HANDLE,
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

/** SQL: `now` as a local date in the timezone in `tzCol`. */
const localToday = (tzCol: unknown, now: Date) => sql`((${now.toISOString()}::timestamptz at time zone ${tzCol})::date)`;

/**
 * SQL: the user in `userIdCol` (timezone in `tzCol`) logged in the activity window: the CLAN_INACTIVE_DAYS full
 * local days ending yesterday (today - 5 .. today - 1; today does not count). The single definition of clan
 * activity, used by the clan score, the dead-weight rule, raids, the roster and the routes. A forbidden log is not activity.
 * Pass table-qualified references (a bare column name would resolve against `logs` inside the subquery).
 */
export function activeSql(userIdCol: unknown, tzCol: unknown, now: Date): SQL<boolean> {
  const today = localToday(tzCol, now);
  return sql<boolean>`exists (select 1 from ${logs} l where l.user_id = ${userIdCol} and l.local_date >= ${today} - ${CLAN_INACTIVE_DAYS}::int and l.local_date < ${today} and not l.forbidden)`;
}

/**
 * SQL: the member is dead weight: in the clan since the window's first local day (or earlier) and no log in the
 * window, i.e. CLAN_INACTIVE_DAYS consecutive inactive local days as a member. A fresh joiner never is.
 */
export function deadWeightSql(userIdCol: unknown, joinedAtCol: unknown, tzCol: unknown, now: Date): SQL<boolean> {
  return sql<boolean>`((${joinedAtCol} at time zone ${tzCol})::date <= ${localToday(tzCol, now)} - ${CLAN_INACTIVE_DAYS}::int and not ${activeSql(userIdCol, tzCol, now)})`;
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

/** The players a dispatch line names: `text` then carries `{actor}` / `{subject}` placeholders (see renderDispatch). */
export interface DispatchRefs {
  templateKey: string;
  actorId?: string | null;
  subjectId?: string | null;
}

export async function addDispatch(tx: Pick<Db, "insert">, clanId: string, kind: string, text: string, now: Date, refs?: DispatchRefs) {
  await tx.insert(clanDispatches).values({
    clanId,
    kind,
    text,
    createdAt: now,
    templateKey: refs?.templateKey ?? null,
    actorId: refs?.actorId ?? null,
    subjectId: refs?.subjectId ?? null,
  });
}

/**
 * Fills a templated dispatch for a member of `clanId`: a player still in the clan by username (the clanmate
 * projection), a former member by the public projection (codename unless public), a deleted account (the id went
 * null) as FORMER OPERATOR, which also replaces a leading `OPERATOR `. Rows without a template key render as stored.
 */
export function renderDispatch(
  row: { text: string; templateKey: string | null; actorId: string | null; subjectId: string | null },
  handleOf: (userId: string) => string | null,
): string {
  if (!row.templateKey) return row.text;
  let text = row.text;
  for (const [role, id] of [["actor", row.actorId], ["subject", row.subjectId]] as const) {
    const token = `{${role}}`;
    if (!text.includes(token)) continue;
    const handle = id ? handleOf(id) : null;
    text = handle === null ? text.split(`OPERATOR ${token}`).join(FORMER_OPERATOR_HANDLE).split(token).join(FORMER_OPERATOR_HANDLE) : text.split(token).join(handle);
  }
  return text;
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

/** SQL: the user logged today (local), a non-forbidden log. */
export function loggedTodaySql(userIdCol: unknown, tzCol: unknown, now: Date): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${logs} l where l.user_id = ${userIdCol} and l.local_date = ${localToday(tzCol, now)} and not l.forbidden)`;
}

/**
 * SQL: the leader may remove the member now: dead weight by the window rule, and no non-forbidden log today. A
 * member who shows up today cannot be removed today, although flagging keeps the window that ends yesterday.
 */
export function removableSql(userIdCol: unknown, joinedAtCol: unknown, tzCol: unknown, now: Date): SQL<boolean> {
  return sql<boolean>`(${deadWeightSql(userIdCol, joinedAtCol, tzCol, now)} and not ${loggedTodaySql(userIdCol, tzCol, now)})`;
}

/** Whether the member `userId` is dead weight right now by the window rule (see deadWeightSql). */
export async function isDeadWeight(db: Reader, userId: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ dead: deadWeightSql(clanMembers.userId, clanMembers.joinedAt, users.timezone, now) })
    .from(clanMembers)
    .innerJoin(users, eq(users.id, clanMembers.userId))
    .where(eq(clanMembers.userId, userId))
    .limit(1);
  return !!row?.dead;
}

/** Whether the leader may remove the member `userId` right now (see removableSql). */
export async function isRemovable(db: Reader, userId: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ dead: removableSql(clanMembers.userId, clanMembers.joinedAt, users.timezone, now) })
    .from(clanMembers)
    .innerJoin(users, eq(users.id, clanMembers.userId))
    .where(eq(clanMembers.userId, userId))
    .limit(1);
  return !!row?.dead;
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
  // Ranked clans are always scored; an unscored row is not a leaderboard entry.
  return rows.flatMap((r) => (r.clanScore === null ? [] : [{ ...summary(r, n.get(r.id) ?? 0), clanScore: r.clanScore }]));
}

export async function toClanDto(db: Reader, c: ClanRow, myRole: ClanRole): Promise<Clan> {
  return {
    ...summary(c, await memberCount(db, c.id)),
    description: c.description,
    clanScore: c.clanScore,
    activeMemberCount: c.activeMemberCount,
    raidWins: c.raidWins,
    inviteCode: c.inviteCode,
    createdAt: c.createdAt.toISOString(),
    myRole,
  };
}

/**
 * The members as a clanmate sees them: the clanmate projection (usernames always, PRD 16), role, the dead-weight
 * flag (only while the member is removable: still dead weight and no log today) and the 30-day quest completion %. Leader first, then by join time.
 */
export async function clanMembersView(db: Reader, clanId: string, viewerId: string, now: Date): Promise<ClanMember[]> {
  const rows = await db
    .select({
      userId: clanMembers.userId,
      role: clanMembers.role,
      flaggedAt: clanMembers.flaggedAt,
      removable: removableSql(clanMembers.userId, clanMembers.joinedAt, users.timezone, now),
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
      flagged: r.flaggedAt !== null && r.removable,
      questCompletionRate30d: r.resolved > 0 ? Math.round((r.completed / r.resolved) * 100) : null,
    });
  }
  return out;
}

/** The clan's latest dispatches as its members see them now (names rendered at read time, see renderDispatch). */
export async function recentDispatches(db: Reader, clanId: string, now: Date, limit = 10): Promise<ClanDispatch[]> {
  const rows = await db
    .select()
    .from(clanDispatches)
    .where(eq(clanDispatches.clanId, clanId))
    .orderBy(desc(clanDispatches.createdAt), desc(clanDispatches.id))
    .limit(limit);
  const ids = [...new Set(rows.flatMap((r) => (r.templateKey ? [r.actorId, r.subjectId].filter((x): x is string => !!x) : [])))];
  const subjects = await loadProjectionSubjects(db, ids, now);
  const members = ids.length
    ? new Set(
        (await db.select({ userId: clanMembers.userId }).from(clanMembers).where(and(eq(clanMembers.clanId, clanId), inArray(clanMembers.userId, ids)))).map(
          (m) => m.userId,
        ),
      )
    : new Set<string>();
  const handleOf = (userId: string) => {
    const s = subjects.get(userId);
    return s ? projectUser(s, members.has(userId) ? "clanmate" : "public").handle : null;
  };
  return rows.map((r) => ({ id: r.id, kind: r.kind, text: renderDispatch(r, handleOf), createdAt: r.createdAt.toISOString() }));
}

// --- daily jobs ---------------------------------------------------------------------------------

/** `YYYY-MM` of `now` in UTC (the raid bonus month). */
export const utcMonth = (now: Date) => now.toISOString().slice(0, 7);

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ClanScore {
  /** Null with fewer than CLAN_SCORE_MIN_ACTIVE active members. */
  score: number | null;
  activeMemberCount: number;
}

/**
 * Clan score of each clan: the mean hidden score of its members active in the window (inactive ones excluded)
 * plus the raid bonus accumulated in the current UTC month. With fewer than CLAN_SCORE_MIN_ACTIVE active members
 * there is no score (a mean of one or two members would reveal their hidden scores). Hidden scores stay server-side.
 */
export async function computeClanScores(db: Reader, clanRows: ClanRow[], now: Date): Promise<Map<string, ClanScore>> {
  const out = new Map<string, ClanScore>();
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
    const score =
      mine.length < CLAN_SCORE_MIN_ACTIVE
        ? null
        : round2(mine.reduce((a, b) => a + b, 0) / mine.length + (c.raidBonusMonth === month ? c.raidBonus : 0));
    out.set(c.id, { score, activeMemberCount: mine.length });
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

/**
 * Global rank by clan score among `active` clans with at least CLAN_SCORE_MIN_ACTIVE active members (ties: older
 * clan first). Every other clan is unranked.
 */
export async function assignClanRanks(db: Pick<Db, "execute">): Promise<void> {
  const ranked = sql`status = 'active' and active_member_count >= ${CLAN_SCORE_MIN_ACTIVE}::int and clan_score is not null`;
  await db.execute(sql`
    update ${clans} c set clan_rank = r.rk
    from (select id, row_number() over (order by clan_score desc, created_at asc, id asc)::int as rk from ${clans} where ${ranked}) r
    where c.id = r.id`);
  await db.execute(sql`update ${clans} set clan_rank = null where not (${ranked}) and clan_rank is not null`);
}

/**
 * Flags dead weight (see deadWeightSql; keeps an earlier flag time) and clears the flag of members who no longer
 * are. Two set-based statements.
 */
export async function updateDeadWeightFlags(db: Pick<Db, "execute">, now: Date): Promise<{ flagged: number; cleared: number }> {
  const flagged = await db.execute(sql`
    update ${clanMembers} m set flagged_at = ${now.toISOString()}::timestamptz
    from ${users} u
    where u.id = m.user_id and m.flagged_at is null and ${deadWeightSql(sql`m.user_id`, sql`m.joined_at`, sql`u.timezone`, now)}`);
  const cleared = await db.execute(sql`
    update ${clanMembers} m set flagged_at = null
    from ${users} u
    where u.id = m.user_id and m.flagged_at is not null and not ${deadWeightSql(sql`m.user_id`, sql`m.joined_at`, sql`u.timezone`, now)}`);
  return { flagged: flagged.rowCount ?? 0, cleared: cleared.rowCount ?? 0 };
}
