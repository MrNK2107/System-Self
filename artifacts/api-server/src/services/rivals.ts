/**
 * Rivals: three slots per user, filled with a real player of the same rank (hidden score within 5, widening to
 * 10, active in the last 7 days, not blocked) when the user is rank D or above, else with ghost rivals (server
 * simulations, cold start). Ghost drift, rival pressure and rival-challenge resolution run in the user's
 * rollover (rivalRollover). The hidden score is only used here to match; it never leaves the server.
 */
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import {
  blocks,
  clanMembers,
  dailySnapshots,
  domainScores,
  duoMembers,
  follows,
  ghostRivals,
  logs,
  notices,
  profiles,
  rivalAssignments,
  rivalChallenges,
  rivalPressure,
  rivalTaunts,
  shadowSelves,
  users,
  type Db,
  type GhostRival,
  type RivalAssignment,
  type RivalChallengeRow,
} from "@workspace/db";
import {
  CODENAME_SINGLE_WORD_ATTEMPTS,
  RANKED_DOMAINS,
  addDays,
  generateRivalCodename,
  ghostDrift,
  localDate,
  makeGhost,
  shadowRank,
  shadowScores,
  type GhostTrajectory,
  type Rank,
  type RankedDomain,
} from "@workspace/engine";
import type { Notice, PublicProfile, RivalChallenge, RivalChallengeOutcome, RivalTaunt, RivalsResponse } from "@workspace/contracts";
import { loadProjectionSubjects, projectGhost, projectUser } from "./projection";
import { insertNotice, toShadowState } from "./scoring";
import { hiddenAndTrajectoryBatch } from "./state";
import type { Tx } from "./user-lock";

export const RIVAL_SLOTS = [1, 2, 3] as const;
/** A slot is re-matched this long after it was filled (or at once on the user's rank change). */
export const RIVAL_TERM_MS = 30 * 86_400_000;
export const MATCH_WINDOW = 5;
export const WIDE_MATCH_WINDOW = 10;
/** A real candidate must have logged within this many days. */
export const ACTIVE_WINDOW_MS = 7 * 86_400_000;
/** Real candidates considered per fill (ranked by hidden-score distance). */
const CANDIDATE_LIMIT = 500;
const RECENT_RESOLVED_CHALLENGES = 10;
const TAUNTS_LISTED = 20;

type Reader = Pick<Db, "select">;
type Scores = Record<RankedDomain, number>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const emptyScores = (): Scores => Object.fromEntries(RANKED_DOMAINS.map((d) => [d, 0])) as Scores;
const asScores = (raw: unknown): Scores => {
  const out = emptyScores();
  const src = (raw ?? {}) as Partial<Record<string, number>>;
  for (const d of RANKED_DOMAINS) out[d] = typeof src[d] === "number" ? src[d]! : 0;
  return out;
};

async function scoresOf(db: Reader, ids: readonly string[]): Promise<Map<string, Scores>> {
  const out = new Map<string, Scores>();
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, emptyScores());
  const rows = await db.select().from(domainScores).where(inArray(domainScores.userId, [...ids]));
  for (const r of rows) {
    const m = out.get(r.userId);
    if (m && (RANKED_DOMAINS as readonly string[]).includes(r.domain)) m[r.domain as RankedDomain] = r.score;
  }
  return out;
}

/** Ids of players with a block in either direction with `userId`. */
async function blockedWith(db: Reader, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ blocker: blocks.blockerId, blocked: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
  return new Set(rows.map((r) => (r.blocker === userId ? r.blocked : r.blocker)));
}

/**
 * Players tied to `userId` by a relation that already shows them to each other: current clanmates, the duo partner,
 * and follows in either direction. A tied player is never a rival (the rival codename would be de-anonymised by
 * comparing scores and trajectories with the clan roster, the duo or the following list).
 */
export async function socialTiesOf(db: Reader, userId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const [clan] = await db.select({ clanId: clanMembers.clanId }).from(clanMembers).where(eq(clanMembers.userId, userId)).limit(1);
  if (clan) {
    for (const m of await db.select({ userId: clanMembers.userId }).from(clanMembers).where(eq(clanMembers.clanId, clan.clanId))) out.add(m.userId);
  }
  const [duo] = await db.select({ duoId: duoMembers.duoId }).from(duoMembers).where(eq(duoMembers.userId, userId)).limit(1);
  if (duo) {
    for (const m of await db.select({ userId: duoMembers.userId }).from(duoMembers).where(eq(duoMembers.duoId, duo.duoId))) out.add(m.userId);
  }
  const rows = await db
    .select({ follower: follows.followerId, followee: follows.followeeId })
    .from(follows)
    .where(or(eq(follows.followerId, userId), eq(follows.followeeId, userId)));
  for (const r of rows) out.add(r.follower === userId ? r.followee : r.follower);
  out.delete(userId);
  return out;
}

/**
 * Re-matches every real rival slot that now pairs `actorId` with a tied player (see socialTiesOf), right after the
 * actor's request created the tie (a follow, a clan join, a duo accept). The actor's own slots are re-matched under
 * the actor's lock, which the caller holds. The other side's slots need that player's lock: it is only tried (never
 * waited for, so no lock cycle can form) and, when busy, their next read or the social job re-matches them, because
 * ensureAssignments drops tied rivals too.
 */
export async function rematchTies(tx: Tx, actorId: string, now: Date): Promise<void> {
  const ties = await socialTiesOf(tx, actorId);
  if (ties.size === 0) return;
  const tied = [...ties];
  const rows = await tx
    .select({ userId: rivalAssignments.userId })
    .from(rivalAssignments)
    .where(
      or(
        and(eq(rivalAssignments.userId, actorId), inArray(rivalAssignments.rivalUserId, tied)),
        and(eq(rivalAssignments.rivalUserId, actorId), inArray(rivalAssignments.userId, tied)),
      ),
    );
  const owners = [...new Set(rows.map((r) => r.userId))].sort();
  for (const owner of owners) {
    if (owner !== actorId) {
      const res = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${owner})) as ok`);
      if (!(res.rows[0] as { ok: boolean } | undefined)?.ok) continue;
    }
    await ensureAssignments(tx, owner, now);
  }
}

/** Current scores of each assignment's rival (the ghost's, or the real player's domain scores). */
export async function rivalScores(db: Reader, assignments: readonly RivalAssignment[]): Promise<Map<string, Scores>> {
  const out = new Map<string, Scores>();
  const ghostIds = assignments.flatMap((a) => (a.ghostId ? [a.ghostId] : []));
  const realIds = assignments.flatMap((a) => (a.rivalUserId ? [a.rivalUserId] : []));
  const ghosts = ghostIds.length > 0 ? await db.select().from(ghostRivals).where(inArray(ghostRivals.id, ghostIds)) : [];
  const real = await scoresOf(db, realIds);
  for (const a of assignments) {
    if (a.ghostId) {
      const g = ghosts.find((x) => x.id === a.ghostId);
      if (g) out.set(a.id, asScores(g.scores));
    } else if (a.rivalUserId && real.has(a.rivalUserId)) out.set(a.id, real.get(a.rivalUserId)!);
  }
  return out;
}

/** A RIVAL codename not used by any of the user's other slots. */
function freshRivalCodename(taken: Set<string>): string {
  for (let attempt = 0; attempt < CODENAME_SINGLE_WORD_ATTEMPTS * 4; attempt++) {
    const c = generateRivalCodename(Math.random, attempt);
    if (!taken.has(c)) return c;
  }
  throw new Error("no free rival codename");
}

async function initPressure(tx: Tx, userId: string, assignmentId: string, user: Scores, rival: Scores): Promise<void> {
  await tx
    .insert(rivalPressure)
    .values(RANKED_DOMAINS.map((domain) => ({ userId, assignmentId, domain, ahead: rival[domain] > user[domain] })))
    .onConflictDoNothing();
}

/** Expires every slot of the user (rank change): ensureAssignments re-matches them at the next read or job. */
export async function expireAssignments(tx: Pick<Tx, "update">, userId: string, now: Date): Promise<void> {
  await tx.update(rivalAssignments).set({ expiresAt: now }).where(and(eq(rivalAssignments.userId, userId), sql`${rivalAssignments.expiresAt} > ${now}`));
}

/** Closes an open challenge without a winner (its rival is gone, blocked or now tied). No notice, outside the record. */
async function voidChallenge(tx: Pick<Tx, "update">, id: string, now: Date): Promise<void> {
  await tx
    .update(rivalChallenges)
    .set({ outcome: "void", resolvedAt: now, acknowledgedAt: now })
    .where(and(eq(rivalChallenges.id, id), isNull(rivalChallenges.outcome)));
}

/**
 * Fills the user's empty and expired slots (and slots whose real rival is now blocked or tied to the user, see
 * socialTiesOf) with a real match or a ghost. A slot with an open challenge is kept until the challenge resolves
 * (unless its rival is blocked or tied: the challenge is voided). Called by GET /api/rivals, the social job and
 * rematchTies. Must run inside withUserLock.
 */
export async function ensureAssignments(tx: Tx, userId: string, now: Date, opts: { candidateLimit?: number } = {}): Promise<void> {
  const [me] = await tx
    .select({ tz: users.timezone, rank: profiles.rank })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!me) return;
  const rank = me.rank as Rank;
  const today = localDate(now, me.tz);

  const current = await tx.select().from(rivalAssignments).where(eq(rivalAssignments.userId, userId));
  const open = await tx
    .select({ id: rivalChallenges.id, assignmentId: rivalChallenges.assignmentId })
    .from(rivalChallenges)
    .where(and(eq(rivalChallenges.userId, userId), isNull(rivalChallenges.outcome)));
  const blocked = await blockedWith(tx, userId);
  const ties = await socialTiesOf(tx, userId);

  const kept: RivalAssignment[] = [];
  const replaced: RivalAssignment[] = [];
  for (const a of current) {
    const challenge = open.find((c) => c.assignmentId === a.id);
    if (a.rivalUserId && (blocked.has(a.rivalUserId) || ties.has(a.rivalUserId))) {
      if (challenge) await voidChallenge(tx, challenge.id, now);
      replaced.push(a);
    } else if (a.expiresAt.getTime() <= now.getTime() && !challenge) replaced.push(a);
    else kept.push(a);
  }
  const free = RIVAL_SLOTS.filter((s) => !kept.some((a) => a.slot === s));
  if (free.length === 0) return;

  for (const a of replaced) {
    await tx.delete(rivalAssignments).where(eq(rivalAssignments.id, a.id));
    if (a.ghostId) await tx.delete(ghostRivals).where(eq(ghostRivals.id, a.ghostId));
  }

  const myScores = (await scoresOf(tx, [userId])).get(userId)!;
  const picks = rank === "E" ? [] : await matchCandidates(tx, userId, rank, today, myScores, kept, new Set([...blocked, ...ties]), now, opts.candidateLimit ?? CANDIDATE_LIMIT);
  const taken = new Set(kept.map((a) => a.codename));
  const real = await scoresOf(tx, picks);

  for (const slot of free) {
    const codename = freshRivalCodename(taken);
    taken.add(codename);
    const expiresAt = new Date(now.getTime() + RIVAL_TERM_MS);
    const rivalUserId = picks.shift();
    if (rivalUserId) {
      const [row] = await tx
        .insert(rivalAssignments)
        .values({ userId, slot, rivalUserId, codename, assignedAt: now, expiresAt })
        .returning();
      await initPressure(tx, userId, row!.id, myScores, real.get(rivalUserId)!);
      continue;
    }
    const ghost = makeGhost(rank);
    const [g] = await tx
      .insert(ghostRivals)
      .values({
        ownerId: userId,
        codename,
        rank: ghost.rank,
        scores: ghost.scores,
        trajectory: ghost.trajectory,
        shadowActive: ghost.shadowActive,
        // The first drift is for today, at today's rollover.
        lastDriftDate: addDays(today, -1),
        createdAt: now,
      })
      .returning();
    const [row] = await tx
      .insert(rivalAssignments)
      .values({ userId, slot, ghostId: g!.id, codename, assignedAt: now, expiresAt })
      .returning();
    await initPressure(tx, userId, row!.id, myScores, ghost.scores);
  }
}

/**
 * Real players for the user's free slots, best first: same rank, active in the last 7 days, not blocked or tied
 * (`excluded`: blocks, clanmates, the duo partner, follows either way), not already one of the user's rivals,
 * hidden score within MATCH_WINDOW (preferred) or WIDE_MATCH_WINDOW.
 */
async function matchCandidates(
  tx: Tx,
  userId: string,
  rank: Rank,
  today: string,
  myScores: Scores,
  kept: readonly RivalAssignment[],
  excluded: ReadonlySet<string>,
  now: Date,
  candidateLimit: number,
): Promise<string[]> {
  const exclude = new Set([userId, ...excluded, ...kept.flatMap((a) => (a.rivalUserId ? [a.rivalUserId] : []))]);
  const since = new Date(now.getTime() - ACTIVE_WINDOW_MS);
  const mine = (await hiddenAndTrajectoryBatch(tx, [{ userId, today, scoreMap: myScores }])).get(userId)!.hidden;
  // Pre-sort in SQL by the distance between each candidate's latest daily snapshot hidden score and mine, so the
  // cap keeps the closest candidates (not the lowest ids). A candidate without a snapshot sorts last. The exact
  // live score is still computed below for the survivors, and the final order uses that.
  const snapshotGap = sql`abs(coalesce((select ds.hidden from ${dailySnapshots} ds where ds.user_id = ${users.id} order by ds.local_date desc limit 1), 1e6) - ${mine})`;
  const rows = await tx
    .select({ id: users.id, tz: users.timezone })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(
        eq(profiles.rank, rank),
        ne(users.id, userId),
        exclude.size > 0 ? notInArray(users.id, [...exclude]) : undefined,
        sql`exists (select 1 from ${logs} l where l.user_id = ${users.id} and l.occurred_at >= ${since})`,
      ),
    )
    .orderBy(asc(snapshotGap), asc(users.id))
    .limit(candidateLimit);
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const scores = await scoresOf(tx, ids);
  const hidden = await hiddenAndTrajectoryBatch(tx, [
    ...rows.filter((r) => ids.includes(r.id)).map((r) => ({ userId: r.id, today: localDate(now, r.tz), scoreMap: scores.get(r.id)! })),
  ]);
  const ranked = ids
    .map((id) => ({ id, gap: Math.abs(hidden.get(id)!.hidden - mine) }))
    .filter((c) => c.gap <= WIDE_MATCH_WINDOW)
    .sort((x, y) => x.gap - y.gap || (x.id < y.id ? -1 : 1));
  // Within MATCH_WINDOW first (already sorted by gap), then the widened window.
  return [...ranked.filter((c) => c.gap <= MATCH_WINDOW), ...ranked.filter((c) => c.gap > MATCH_WINDOW)].map((c) => c.id);
}

// --- rollover -----------------------------------------------------------------------------------

/**
 * The rival steps of the user's rollover for local `date` (after the snapshot, rank and shadow steps): drift the
 * user's ghosts once for `date`, notice rivals that passed the user in a domain (once until the order flips back),
 * and resolve rival challenges whose window ended by `date` (no score effect). Must run inside withUserLock.
 */
export async function rivalRollover(tx: Tx, userId: string, date: string, now: Date): Promise<Notice[]> {
  const out: Notice[] = [];
  const ghosts = await tx.select().from(ghostRivals).where(eq(ghostRivals.ownerId, userId));
  for (const g of ghosts) {
    if (g.lastDriftDate !== null && g.lastDriftDate >= date) continue;
    const next = ghostDrift(toGhostState(g), date);
    await tx.update(ghostRivals).set({ scores: next.scores, lastDriftDate: date }).where(eq(ghostRivals.id, g.id));
  }

  const assignments = await tx.select().from(rivalAssignments).where(eq(rivalAssignments.userId, userId)).orderBy(asc(rivalAssignments.slot));
  const theirs = await rivalScores(tx, assignments);
  const mine = (await scoresOf(tx, [userId])).get(userId)!;

  const pressure = await tx.select().from(rivalPressure).where(eq(rivalPressure.userId, userId));
  for (const a of assignments) {
    const rival = theirs.get(a.id);
    if (!rival) continue;
    for (const domain of RANKED_DOMAINS) {
      const ahead = rival[domain] > mine[domain];
      const prev = pressure.find((p) => p.assignmentId === a.id && p.domain === domain);
      if (!prev) {
        await tx.insert(rivalPressure).values({ userId, assignmentId: a.id, domain, ahead }).onConflictDoNothing();
        continue;
      }
      if (prev.ahead === ahead) continue;
      await tx
        .update(rivalPressure)
        .set({ ahead })
        .where(and(eq(rivalPressure.userId, userId), eq(rivalPressure.assignmentId, a.id), eq(rivalPressure.domain, domain)));
      if (ahead) out.push(await insertNotice(tx, userId, "rival_passed", { codename: a.codename, domain, isGhost: a.ghostId !== null }, now));
    }
  }

  const due = await tx
    .select()
    .from(rivalChallenges)
    .where(and(eq(rivalChallenges.userId, userId), isNull(rivalChallenges.outcome), lte(rivalChallenges.endDate, date)))
    .orderBy(asc(rivalChallenges.createdAt));
  for (const c of due) {
    const rival = c.assignmentId ? theirs.get(c.assignmentId) : undefined;
    if (!rival) {
      await voidChallenge(tx, c.id, now);
      continue;
    }
    const domain = c.domain as RankedDomain;
    const userEnd = round2(mine[domain]);
    const rivalEnd = round2(rival[domain]);
    const userGain = round2(userEnd - c.userStart);
    const rivalGain = round2(rivalEnd - c.rivalStart);
    const outcome = userGain > rivalGain ? "win" : userGain < rivalGain ? "loss" : "draw";
    await tx
      .update(rivalChallenges)
      .set({ outcome, userEnd, rivalEnd, resolvedAt: now })
      .where(eq(rivalChallenges.id, c.id));
    out.push(
      await insertNotice(
        tx,
        userId,
        "rival_challenge_result",
        {
          challengeId: c.id,
          codename: c.codename,
          domain,
          outcome,
          startDate: c.startDate,
          endDate: c.endDate,
          userStart: c.userStart,
          userEnd,
          rivalStart: c.rivalStart,
          rivalEnd,
        },
        now,
      ),
    );
  }
  return out;
}

function toGhostState(g: GhostRival) {
  return {
    id: g.id,
    rank: g.rank as Rank,
    scores: asScores(g.scores),
    trajectory: g.trajectory as GhostTrajectory,
    shadowActive: g.shadowActive,
  };
}

// --- reads --------------------------------------------------------------------------------------

/** The user's own assignment, or null (another user's or unknown). */
export async function ownAssignment(db: Reader, userId: string, assignmentId: string): Promise<RivalAssignment | null> {
  const [row] = await db
    .select()
    .from(rivalAssignments)
    .where(and(eq(rivalAssignments.id, assignmentId), eq(rivalAssignments.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Each assignment as its viewer may see it: a ghost projection or projectUser(subject, "rival"). */
export async function rivalProfiles(db: Reader, assignments: readonly RivalAssignment[], now: Date): Promise<Map<string, PublicProfile>> {
  const out = new Map<string, PublicProfile>();
  const ghostIds = assignments.flatMap((a) => (a.ghostId ? [a.ghostId] : []));
  const ghosts = ghostIds.length > 0 ? await db.select().from(ghostRivals).where(inArray(ghostRivals.id, ghostIds)) : [];
  const subjects = await loadProjectionSubjects(db, assignments.flatMap((a) => (a.rivalUserId ? [a.rivalUserId] : [])), now);
  for (const a of assignments) {
    if (a.ghostId) {
      const g = ghosts.find((x) => x.id === a.ghostId);
      if (g) out.set(a.id, projectGhost({ ...toGhostState(g), codename: a.codename }));
    } else if (a.rivalUserId) {
      const s = subjects.get(a.rivalUserId);
      // rivalReveal is a P7 unlock: until then a rival is always shown by the assignment codename.
      if (s) out.set(a.id, projectUser(s, "rival", { rivalCodename: a.codename, rivalReveal: false }));
    }
  }
  return out;
}

export function toChallengeDto(c: RivalChallengeRow, live?: { user: Scores; rival: Scores | undefined }): RivalChallenge {
  const domain = c.domain as RankedDomain;
  const open = c.outcome === null;
  return {
    id: c.id,
    assignmentId: c.assignmentId,
    codename: c.codename,
    domain,
    startDate: c.startDate,
    endDate: c.endDate,
    userStart: c.userStart,
    rivalStart: c.rivalStart,
    userCurrent: open ? round2(live?.user[domain] ?? c.userStart) : (c.userEnd ?? c.userStart),
    rivalCurrent: open ? round2(live?.rival?.[domain] ?? c.rivalStart) : (c.rivalEnd ?? c.rivalStart),
    outcome: c.outcome as RivalChallengeOutcome | null,
    acknowledged: c.acknowledgedAt !== null,
  };
}

export function toTauntDto(t: typeof rivalTaunts.$inferSelect): RivalTaunt {
  return { id: t.id, codename: t.codename, isGhost: t.isGhost, message: t.message, createdAt: t.createdAt.toISOString(), read: t.readAt !== null };
}

/** GET /api/rivals: slots, the user's own shadow, challenges (open + recent), record and transmissions. */
export async function buildRivalsResponse(db: Reader, userId: string, now: Date): Promise<RivalsResponse> {
  const assignments = await db.select().from(rivalAssignments).where(eq(rivalAssignments.userId, userId)).orderBy(asc(rivalAssignments.slot));
  const profilesById = await rivalProfiles(db, assignments, now);
  const rivals = assignments.flatMap((a) => {
    const profile = profilesById.get(a.id);
    return profile ? [{ assignmentId: a.id, slot: a.slot, codename: a.codename, isGhost: a.ghostId !== null, profile }] : [];
  });

  const [shadowRow] = await db.select().from(shadowSelves).where(eq(shadowSelves.userId, userId)).limit(1);
  const shadowState = toShadowState(shadowRow);
  const shadow = shadowState
    ? { codename: shadowState.codename, rank: shadowRank(shadowState, now), scores: shadowScores(shadowState, now) }
    : null;

  const openRows = await db
    .select()
    .from(rivalChallenges)
    .where(and(eq(rivalChallenges.userId, userId), isNull(rivalChallenges.outcome)))
    .orderBy(desc(rivalChallenges.createdAt));
  const resolvedRows = await db
    .select()
    .from(rivalChallenges)
    .where(and(eq(rivalChallenges.userId, userId), sql`${rivalChallenges.outcome} is not null`))
    .orderBy(desc(rivalChallenges.resolvedAt), desc(rivalChallenges.createdAt))
    .limit(RECENT_RESOLVED_CHALLENGES);
  const live = await rivalScores(db, assignments);
  const mine = (await scoresOf(db, [userId])).get(userId)!;
  const challenges = [
    ...openRows.map((c) => toChallengeDto(c, { user: mine, rival: c.assignmentId ? live.get(c.assignmentId) : undefined })),
    ...resolvedRows.map((c) => toChallengeDto(c)),
  ];

  const tallies = await db
    .select({ outcome: rivalChallenges.outcome, n: count() })
    .from(rivalChallenges)
    .where(and(eq(rivalChallenges.userId, userId), inArray(rivalChallenges.outcome, ["win", "loss", "draw"])))
    .groupBy(rivalChallenges.outcome);
  const tally = (o: string) => Number(tallies.find((t) => t.outcome === o)?.n ?? 0);

  const taunts = await db
    .select()
    .from(rivalTaunts)
    .where(eq(rivalTaunts.userId, userId))
    .orderBy(desc(rivalTaunts.createdAt), desc(rivalTaunts.id))
    .limit(TAUNTS_LISTED);

  return {
    rivals,
    shadow,
    challenges,
    record: { wins: tally("win"), losses: tally("loss"), draws: tally("draw") },
    taunts: taunts.map(toTauntDto),
  };
}

/** Lines for the next morning briefing: rival_passed notices written on the user's local `today`. */
export async function rivalPassedLines(db: Reader, userId: string, tz: string, today: string, now: Date): Promise<string[]> {
  const rows = await db
    .select({ payload: notices.payload, createdAt: notices.createdAt })
    .from(notices)
    .where(
      and(
        eq(notices.userId, userId),
        eq(notices.kind, "rival_passed"),
        gte(notices.createdAt, new Date(now.getTime() - 2 * 86_400_000)),
      ),
    )
    .orderBy(asc(notices.createdAt), asc(notices.id));
  return rows
    .filter((r) => localDate(r.createdAt, tz) === today)
    .map((r) => {
      const p = r.payload as { codename: string; domain: string };
      return `${p.codename} passed your ${p.domain} score overnight.`;
    });
}

/** Users with an expired slot that can be refilled now (no open challenge holding it), longest expired first. */
export async function usersWithExpiredSlots(db: Pick<Db, "select">, now: Date, limit: number): Promise<string[]> {
  const oldest = sql<Date>`min(${rivalAssignments.expiresAt})`;
  const rows = await db
    .select({ userId: rivalAssignments.userId })
    .from(rivalAssignments)
    .where(
      and(
        lte(rivalAssignments.expiresAt, now),
        sql`not exists (select 1 from ${rivalChallenges} c where c.assignment_id = ${rivalAssignments.id} and c.outcome is null)`,
      ),
    )
    .groupBy(rivalAssignments.userId)
    .orderBy(asc(oldest), asc(rivalAssignments.userId))
    .limit(limit);
  return rows.map((r) => r.userId);
}
