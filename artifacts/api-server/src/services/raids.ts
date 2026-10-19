// Weekly clan raids (PRD 15). Clans are grouped by nearest clan rank at the start of the week; at Sunday 23:59 UTC
// each group is settled: metrics from server data, positions, a winner, the clan score bonus, a dispatch per clan
// and a raid_result notice per member. Everything shown is clan-level: no member's contribution or hidden score.
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { clanMembers, clanRaids, clans, users, type Db } from "@workspace/db";
import type { RaidStanding as RaidStandingDto, RaidSummary } from "@workspace/contracts";
import {
  groupClans,
  raidDispatchText,
  raidRivalValue,
  raidStandings,
  raidTypeForWeek,
  raidWeekOf,
  raidWindow,
  type RaidType,
} from "@workspace/engine";
import { aiAvailable, generateOrTemplate, type AiDeps } from "../lib/ai";
import { activeSql, addDispatch, utcMonth } from "./clans";
import { SYSTEM_PROMPT } from "./ai-context";
import { insertNotice } from "./scoring";
import type { Tx } from "./user-lock";

type Reader = Pick<Db, "select" | "selectDistinct" | "execute">;

/** The clan score bonus per active member for winning a raid (PRD 15). */
export const RAID_WIN_BONUS_PER_ACTIVE = 2.0;

const round2 = (n: number) => Math.round(n * 100) / 100;
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export interface RaidSpan {
  start: Date;
  end: Date;
}

/**
 * The metric of each clan over `span`, from server data only. Only members who were in the clan when the week
 * began count (joining mid-week adds nothing), and forbidden logs never count.
 * - domain: MIND logs. body: BODY logs plus completed gym sessions.
 * - discipline: completed / resolved quests (complete, failed, refused) resolved in the span, in percent.
 * - score: the sum over members of their hidden-score movement (daily snapshots, UTC dates of the span);
 *   a member's contribution is never exposed, only the clan's sum.
 */
export async function raidMetrics(db: Reader, clanIds: string[], type: RaidType, span: RaidSpan): Promise<Map<string, number>> {
  const out = new Map<string, number>(clanIds.map((id) => [id, 0]));
  if (clanIds.length === 0) return out;
  const inClan = sql`m.clan_id in (${idList(clanIds)}) and m.joined_at < ${ts(span.start)}`;
  const inSpan = (col: string) => sql`${sql.raw(col)} >= ${ts(span.start)} and ${sql.raw(col)} < ${ts(span.end)}`;
  if (type === "domain" || type === "body") {
    const domainFilter = type === "domain" ? sql`l.domain = 'MIND'` : sql`l.domain = 'BODY'`;
    const logsQ = await db.execute(sql`
      select m.clan_id, count(*)::int as n from clan_members m join logs l on l.user_id = m.user_id
      where ${inClan} and ${domainFilter} and not l.forbidden and ${inSpan("l.occurred_at")}
      group by m.clan_id`);
    for (const r of logsQ.rows as { clan_id: string; n: number }[]) out.set(r.clan_id, Number(r.n));
    if (type === "body") {
      const sessions = await db.execute(sql`
        select m.clan_id, count(*)::int as n from clan_members m join workout_sessions w on w.user_id = m.user_id
        where ${inClan} and w.completed_at is not null and ${inSpan("w.started_at")}
        group by m.clan_id`);
      for (const r of sessions.rows as { clan_id: string; n: number }[]) out.set(r.clan_id, (out.get(r.clan_id) ?? 0) + Number(r.n));
    }
  } else if (type === "discipline") {
    const q = await db.execute(sql`
      select m.clan_id, count(*) filter (where q.status = 'complete')::int as done, count(*)::int as resolved
      from clan_members m join quests q on q.user_id = m.user_id
      where ${inClan} and q.status in ('complete', 'failed', 'refused') and ${inSpan("q.resolved_at")}
      group by m.clan_id`);
    for (const r of q.rows as { clan_id: string; done: number; resolved: number }[]) {
      out.set(r.clan_id, Number(r.resolved) > 0 ? round2((Number(r.done) / Number(r.resolved)) * 100) : 0);
    }
  } else {
    const startDate = utcDay(span.start);
    const endDate = utcDay(span.end);
    const q = await db.execute(sql`
      select m.clan_id, coalesce(sum(e.hidden - coalesce(b1.hidden, b2.hidden)), 0)::float8 as v
      from clan_members m
      cross join lateral (select hidden from daily_snapshots s where s.user_id = m.user_id and s.local_date <= ${endDate}::date order by s.local_date desc limit 1) e
      left join lateral (select hidden from daily_snapshots s where s.user_id = m.user_id and s.local_date < ${startDate}::date order by s.local_date desc limit 1) b1 on true
      left join lateral (select hidden from daily_snapshots s where s.user_id = m.user_id and s.local_date >= ${startDate}::date and s.local_date <= ${endDate}::date order by s.local_date asc limit 1) b2 on true
      where ${inClan}
      group by m.clan_id`);
    for (const r of q.rows as { clan_id: string; v: number }[]) out.set(r.clan_id, round2(Number(r.v)));
  }
  return out;
}

/** Members of each clan active (see activeSql) at the instant `at`. */
export async function activeMemberCounts(db: Reader, clanIds: string[], at: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>(clanIds.map((id) => [id, 0]));
  if (clanIds.length === 0) return out;
  const rows = await db
    .select({ clanId: clanMembers.clanId, n: count() })
    .from(clanMembers)
    .innerJoin(users, eq(users.id, clanMembers.userId))
    .where(and(inArray(clanMembers.clanId, clanIds), activeSql(clanMembers.userId, users.timezone, at)))
    .groupBy(clanMembers.clanId);
  for (const r of rows) out.set(r.clanId, r.n);
  return out;
}

/**
 * Enters this week's raids: every active, ranked clan not yet entered is grouped by nearest rank (groups of 2-4)
 * and gets one clan_raids row. Forming and unranked clans are left out; a lone clan has no raid. One transaction,
 * and the unique (weekKey, clanId) makes a repeat a no-op. Returns the clans entered.
 */
export async function startRaidWeek(db: Db, now: Date): Promise<number> {
  const week = raidWeekOf(now);
  const type = raidTypeForWeek(week.week);
  return db.transaction(async (tx) => {
    const eligible = await tx
      .select({ id: clans.id, clanRank: clans.clanRank })
      .from(clans)
      .where(
        and(
          eq(clans.status, "active"),
          isNotNull(clans.clanRank),
          sql`not exists (select 1 from ${clanRaids} r where r.week_key = ${week.weekKey} and r.clan_id = ${clans.id})`,
        ),
      );
    const groups = groupClans(eligible.map((c) => ({ id: c.id, clanRank: c.clanRank! })));
    const values = groups.flatMap((g) => {
      const groupId = randomUUID();
      return g.map((clanId) => ({ weekKey: week.weekKey, type, groupId, clanId }));
    });
    if (values.length === 0) return 0;
    await tx.insert(clanRaids).values(values).onConflictDoNothing();
    return values.length;
  });
}

// --- resolution ----------------------------------------------------------------------------------

const hasEmoji = (text: string) => /\p{Extended_Pictographic}/u.test(text);
const numbersIn = (text: string) => text.match(/\d+(?:\.\d+)?/g) ?? [];

/**
 * The dispatch text: the AI's rewrite of the template when available and sound (keeps every number, no emoji,
 * no exclamation marks, short), else the template itself.
 */
export async function raidDispatch(template: string, ai: AiDeps): Promise<string> {
  if (!aiAvailable()) return template;
  const result = await generateOrTemplate(
    {
      systemInstruction: SYSTEM_PROMPT,
      prompt: `Rewrite this clan raid result dispatch in two short sentences at most. Keep every number and the words RAID RESULT and the week number exactly. Output only the dispatch.\n\n${template}`,
      maxOutputTokens: 160,
      temperature: 0.6,
    },
    ai.call,
  );
  const text = result.model === "template" ? "" : result.text.trim();
  if (!text || text.length > 400 || text.includes("!") || hasEmoji(text)) return template;
  const have = new Set(numbersIn(text));
  return numbersIn(template).every((n) => have.has(n)) ? text : template;
}

/** Locks the group's rows and runs `write` unless the group was settled meanwhile. */
async function settle(db: Db, groupId: string, now: Date, write: (tx: Tx) => Promise<void>): Promise<boolean> {
  return db.transaction(async (tx) => {
    const locked = await tx.select().from(clanRaids).where(eq(clanRaids.groupId, groupId)).for("update");
    if (locked.length === 0 || locked.some((r) => r.resolvedAt)) return false;
    await write(tx);
    // A void group (fewer than two clans) is closed without a result.
    await tx.update(clanRaids).set({ resolvedAt: now }).where(and(eq(clanRaids.groupId, groupId), isNull(clanRaids.resolvedAt)));
    return true;
  });
}

/**
 * Settles one raid group. Safe to repeat: the group's rows are locked and a group already settled is skipped.
 * Returns true when this call settled it. A group left with fewer than two clans (a clan was deleted) is closed
 * without a result.
 */
export async function resolveRaidGroup(db: Db, groupId: string, now: Date, ai: AiDeps = {}): Promise<boolean> {
  const rows = await db.select().from(clanRaids).where(eq(clanRaids.groupId, groupId));
  if (rows.length === 0 || rows.some((r) => r.resolvedAt)) return false;
  const first = rows[0]!;
  const type = first.type as RaidType;
  const window = raidWindow(first.weekKey);
  const clanIds = rows.map((r) => r.clanId);

  if (rows.length < 2) return settle(db, groupId, now, async () => {});

  const metrics = await raidMetrics(db, clanIds, type, { start: window.start, end: window.end });
  const active = await activeMemberCounts(db, clanIds, window.end);
  const standings = raidStandings(clanIds.map((clanId) => ({ clanId, value: metrics.get(clanId) ?? 0 })));
  const lines = new Map<string, string>();
  for (const s of standings) {
    const template = raidDispatchText({
      week: window.week,
      position: s.position,
      count: standings.length,
      type,
      value: s.value,
      rivalValue: raidRivalValue(standings, s.clanId),
    });
    lines.set(s.clanId, await raidDispatch(template, ai));
  }

  return settle(db, groupId, now, async (tx) => {
    const month = utcMonth(now);
    for (const s of standings) {
      const bonus = s.winner ? round2(RAID_WIN_BONUS_PER_ACTIVE * (active.get(s.clanId) ?? 0)) : 0;
      await tx
        .update(clanRaids)
        .set({ metricValue: s.value, position: s.position, winner: s.winner, resolvedAt: now })
        .where(and(eq(clanRaids.groupId, groupId), eq(clanRaids.clanId, s.clanId)));
      if (s.winner) {
        await tx
          .update(clans)
          .set({
            raidWins: sql`${clans.raidWins} + 1`,
            raidBonus: sql`case when ${clans.raidBonusMonth} = ${month} then ${clans.raidBonus} + ${bonus} else ${bonus} end`,
            raidBonusMonth: month,
            clanScore: sql`case when ${clans.clanScore} is null then null else round((${clans.clanScore} + ${bonus})::numeric, 2)::real end`,
          })
          .where(eq(clans.id, s.clanId));
      }
      const line = lines.get(s.clanId)!;
      await addDispatch(tx, s.clanId, "raid", line, now);
      const members = await tx.select({ userId: clanMembers.userId }).from(clanMembers).where(eq(clanMembers.clanId, s.clanId));
      for (const m of members) {
        await insertNotice(
          tx,
          m.userId,
          "raid_result",
          {
            weekKey: first.weekKey,
            week: window.week,
            type,
            position: s.position,
            count: standings.length,
            won: s.winner,
            value: s.value,
            rivalValue: raidRivalValue(standings, s.clanId),
            bonus,
            line,
          },
          now,
        );
      }
    }
  });
}

/** Groups with an unsettled raid whose week has closed (Sunday 23:59 UTC passed), oldest week first. */
export async function dueRaidGroups(db: Reader, now: Date, limit = 500): Promise<string[]> {
  const rows = await db
    .selectDistinct({ groupId: clanRaids.groupId, weekKey: clanRaids.weekKey })
    .from(clanRaids)
    .where(and(isNull(clanRaids.resolvedAt), lte(clanRaids.weekKey, raidWeekOf(now).weekKey)))
    .orderBy(asc(clanRaids.weekKey), asc(clanRaids.groupId))
    .limit(limit);
  return rows.filter((r) => raidWindow(r.weekKey).end.getTime() <= now.getTime()).map((r) => r.groupId);
}

// --- standings -----------------------------------------------------------------------------------

/**
 * The raid of `clanId` as its members see it: this week's (live standings) or, until this week's is entered, last
 * week's (settled, or closed and not settled yet). Null when the clan has no raid. Clan-level numbers only.
 */
export async function raidSummaryFor(db: Reader, clanId: string, now: Date): Promise<RaidSummary | null> {
  const week = raidWeekOf(now);
  const mine = await db
    .select()
    .from(clanRaids)
    .where(and(eq(clanRaids.clanId, clanId), sql`${clanRaids.weekKey} >= ${raidWeekOf(new Date(week.start.getTime() - 1)).weekKey}`))
    .orderBy(sql`${clanRaids.weekKey} desc`)
    .limit(1);
  const row = mine[0];
  if (!row) return null;
  const group = await db.select().from(clanRaids).where(eq(clanRaids.groupId, row.groupId));
  const info = await db.select().from(clans).where(inArray(clans.id, group.map((g) => g.clanId)));
  const type = row.type as RaidType;
  const w = raidWindow(row.weekKey);
  const resolved = group.every((g) => g.resolvedAt);
  let entries: { clanId: string; value: number }[];
  if (resolved) {
    entries = group.map((g) => ({ clanId: g.clanId, value: g.metricValue }));
  } else {
    const end = now.getTime() < w.end.getTime() ? now : w.end;
    const live = await raidMetrics(db, group.map((g) => g.clanId), type, { start: w.start, end });
    entries = group.map((g) => ({ clanId: g.clanId, value: live.get(g.clanId) ?? 0 }));
  }
  const standings: RaidStandingDto[] = raidStandings(entries).flatMap((s) => {
    const c = info.find((i) => i.id === s.clanId);
    if (!c) return [];
    return [{ clanId: c.id, name: c.name, tag: c.tag, clanRank: c.clanRank, isMine: c.id === clanId, metricValue: s.value, position: s.position }];
  });
  const me = standings.find((s) => s.isMine);
  if (!me || standings.length < 2) return null;
  return {
    weekKey: row.weekKey,
    week: w.week,
    type,
    startsAt: w.start.toISOString(),
    endsAt: w.end.toISOString(),
    resolved,
    standings,
    myPosition: me.position,
    myValue: me.metricValue,
  };
}
