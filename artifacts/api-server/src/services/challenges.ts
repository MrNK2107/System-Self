/**
 * PRO named challenges (PRD 14): one ranked domain, 3/7/14/30 days, metric = domain-score gain over the window.
 * The window starts the local day AFTER acceptance (startDate = the acceptor's accept date + 1; endDate = startDate +
 * days - 1); each start is the owner's snapshot of the accept day. End values are each user's daily snapshot of the end date (their own local
 * date), read live only when a snapshot is missing. The winner gets +3.0 DISCIPLINE and the loser -1.5 through
 * applyChanges with reason `challenge`; a draw changes nothing; an account that is gone voids the challenge.
 * The result is NOT activity (`activity: false`): it is a consequence applied to both players, not something either
 * did, so it must not reset inactivity or consume a comeback, and the central activity helper does not apply.
 *
 * Locking. Resolution touches two users, so it runs under BOTH user locks. Blocking acquisition is always in
 * ascending user-id order (lowest first). A rollover already holds its own user's lock: it blocks only for a HIGHER
 * other user and merely tries the lock of a LOWER one (deferring on failure; the next rollover or the social job
 * resolves it). Nothing ever blocks from a higher id to a lower one, so no wait cycle can form.
 */
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { clanMembers, dailySnapshots, domainScores, follows, namedChallenges, profiles, userDayState, users, type Db, type NamedChallenge } from "@workspace/db";
import {
  CHALLENGE_IGNORED_LINE,
  CHALLENGE_LOSS_DELTA,
  CHALLENGE_WIN_DELTA,
  type Challenge,
  type Notice,
} from "@workspace/contracts";
import { addDays, localDate, type RankedDomain } from "@workspace/engine";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { addDispatch } from "./clans";
import { loadProjectionSubjects, projectUser } from "./projection";
import { ensureRolledOver } from "./rollover";
import { applyChanges, insertNotice } from "./scoring";
import { isBlockedEitherWay, resolveHandle } from "./social";
import type { Tx } from "./user-lock";

type Reader = Pick<Db, "select">;

export const round2 = (n: number) => Math.round(n * 100) / 100;
const HOUR_MS = 3_600_000;
/** Lock namespace for the per-user "open challenge slots" lock (distinct from the one-key user lock). */
const SLOT_LOCK_NAMESPACE = 5502;
/** Closed challenges listed next to the open ones. */
const CLOSED_LISTED = 20;
/** Active challenges examined per job pass. */
const JOB_BATCH = 100;

export const OPEN_STATUSES = ["pending", "active"] as const;

/** Both ids, lowest first: the blocking order of every two-user lock acquisition. */
export function lockOrder(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Takes the user locks of `a` and `b` (the same keys as withUserLock) for the rest of the transaction. `held` is the
 * user whose lock the transaction already owns. Blocks only in ascending id order; a lock lower than `held` is only
 * tried, and false comes back when it is taken by someone else (the caller defers).
 */
export async function lockPair(tx: Pick<Tx, "execute">, a: string, b: string, held?: string): Promise<boolean> {
  for (const id of lockOrder(a, b)) {
    if (id === held) continue;
    if (held !== undefined && id < held) {
      const res = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${id})) as ok`);
      if (!(res.rows[0] as { ok: boolean } | undefined)?.ok) return false;
    } else {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
    }
  }
  return true;
}

/** Serializes the open-challenge count + insert for the given users (ascending order; never held while waiting for a user lock). */
export async function lockSlots(tx: Pick<Tx, "execute">, a: string, b: string): Promise<void> {
  for (const id of lockOrder(a, b)) await tx.execute(sql`select pg_advisory_xact_lock(${SLOT_LOCK_NAMESPACE}::int, hashtext(${id}))`);
}

// --- eligibility ----------------------------------------------------------------------------------

export async function sameClan(db: Reader, a: string, b: string): Promise<boolean> {
  const rows = await db.select({ userId: clanMembers.userId, clanId: clanMembers.clanId }).from(clanMembers).where(inArray(clanMembers.userId, [a, b]));
  return rows.length === 2 && rows[0]!.clanId === rows[1]!.clanId;
}

export async function isFollowing(db: Reader, follower: string, followee: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(follows)
    .where(and(eq(follows.followerId, follower), eq(follows.followeeId, followee)))
    .limit(1);
  return !!row;
}

/**
 * The player `handle` names for `viewer`: a public codename or a public username (resolveHandle), or the username of a
 * clanmate (inside a clan usernames are known). Null when nobody matches (never an oracle for hidden usernames).
 */
export async function resolveOpponent(db: Reader, viewerId: string, handle: string): Promise<{ userId: string } | null> {
  const found = await resolveHandle(db, viewerId, handle);
  if (found) return { userId: found.userId };
  const key = handle.trim().toLowerCase();
  const [mine] = await db.select({ clanId: clanMembers.clanId }).from(clanMembers).where(eq(clanMembers.userId, viewerId)).limit(1);
  if (!mine || !key) return null;
  const [mate] = await db
    .select({ userId: clanMembers.userId })
    .from(clanMembers)
    .innerJoin(users, eq(users.id, clanMembers.userId))
    .where(and(eq(clanMembers.clanId, mine.clanId), sql`lower(${users.username}) = ${key}`))
    .limit(1);
  return mate ?? null;
}

/** A challenge may be issued to a followed user or a clanmate, with no block either way. */
export async function mayChallenge(db: Reader, challengerId: string, opponentId: string): Promise<boolean> {
  if (await isBlockedEitherWay(db, challengerId, opponentId)) return false;
  return (await isFollowing(db, challengerId, opponentId)) || (await sameClan(db, challengerId, opponentId));
}

/** Open (pending + active) challenges the user is part of, in either role. */
export async function openCount(db: Reader, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(namedChallenges)
    .where(and(inArray(namedChallenges.status, [...OPEN_STATUSES]), or(eq(namedChallenges.challengerId, userId), eq(namedChallenges.opponentId, userId))));
  return row?.n ?? 0;
}

export async function openBetween(db: Reader, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ id: namedChallenges.id })
    .from(namedChallenges)
    .where(
      and(
        inArray(namedChallenges.status, [...OPEN_STATUSES]),
        or(
          and(eq(namedChallenges.challengerId, a), eq(namedChallenges.opponentId, b)),
          and(eq(namedChallenges.challengerId, b), eq(namedChallenges.opponentId, a)),
        ),
      ),
    )
    .limit(1);
  return !!row;
}

// --- housekeeping ----------------------------------------------------------------------------------

/** Closes open challenges whose challenger or opponent account is gone: void, no score events. */
export async function voidOrphans(db: Pick<Db, "update">, now: Date, userId?: string): Promise<void> {
  await db
    .update(namedChallenges)
    .set({ status: "void", outcome: "void", resolvedAt: now })
    .where(
      and(
        inArray(namedChallenges.status, [...OPEN_STATUSES]),
        or(isNull(namedChallenges.challengerId), isNull(namedChallenges.opponentId)),
        userId ? or(eq(namedChallenges.challengerId, userId), eq(namedChallenges.opponentId, userId)) : undefined,
      ),
    );
}

/** A block between the two voids their active challenge: no result, no score events. Runs in the blocker's request. */
export async function voidActiveBetween(db: Pick<Db, "update">, a: string, b: string, now: Date): Promise<void> {
  await db
    .update(namedChallenges)
    .set({ status: "void", outcome: "void", resolvedAt: now })
    .where(
      and(
        eq(namedChallenges.status, "active"),
        or(
          and(eq(namedChallenges.challengerId, a), eq(namedChallenges.opponentId, b)),
          and(eq(namedChallenges.challengerId, b), eq(namedChallenges.opponentId, a)),
        ),
      ),
    );
}

/** A pending challenge not answered by `respondBy` (48 h) is ignored; the challenger reads "Challenge ignored. Logged.". */
export async function expirePending(db: Pick<Db, "update">, now: Date, userId?: string): Promise<void> {
  await db
    .update(namedChallenges)
    .set({ status: "ignored" })
    .where(
      and(
        eq(namedChallenges.status, "pending"),
        lte(namedChallenges.respondBy, now),
        isNotNull(namedChallenges.challengerId),
        isNotNull(namedChallenges.opponentId),
        userId ? or(eq(namedChallenges.challengerId, userId), eq(namedChallenges.opponentId, userId)) : undefined,
      ),
    );
}

export const respondByFor = (now: Date, hours: number) => new Date(now.getTime() + hours * HOUR_MS);

// --- resolution ------------------------------------------------------------------------------------

export type ResolveResult = "resolved" | "void" | "deferred" | "inactive";

export async function domainScoreOf(tx: Reader, userId: string, domain: RankedDomain): Promise<number> {
  const [row] = await tx
    .select({ score: domainScores.score })
    .from(domainScores)
    .where(and(eq(domainScores.userId, userId), eq(domainScores.domain, domain)))
    .limit(1);
  return row?.score ?? 0;
}

/** The user's domain score in their daily snapshot of `date` (their own local date), or null when there is none. */
async function snapshotScore(tx: Reader, userId: string, domain: RankedDomain, date: string): Promise<number | null> {
  const [snap] = await tx
    .select({ scores: dailySnapshots.scores })
    .from(dailySnapshots)
    .where(and(eq(dailySnapshots.userId, userId), eq(dailySnapshots.localDate, date)))
    .limit(1);
  const v = (snap?.scores as Partial<Record<string, number>> | undefined)?.[domain];
  return typeof v === "number" ? v : null;
}

/**
 * The start value of a window beginning on `startDate`: the user's own snapshot of the day before, so a day the user
 * has not rolled yet (its penalties, decay) is counted exactly as it will be for the opponent. A user with nothing to
 * roll before the window (rolled through that day, or onboarded on/after the start) starts at the live score. Anyone
 * else gets null now and is filled from their snapshot once it exists (at resolution; see startFromHistory).
 */
export async function startAtAccept(tx: Reader, userId: string, domain: RankedDomain, startDate: string): Promise<number | null> {
  const day = addDays(startDate, -1);
  const snap = await snapshotScore(tx, userId, domain, day);
  if (snap !== null) return round2(snap);
  const [info] = await tx
    .select({ last: userDayState.lastRolledDate, tz: users.timezone, onboardedAt: profiles.onboardedAt })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .leftJoin(userDayState, eq(userDayState.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!info) return null;
  const nothingToRoll = (info.last !== null && info.last >= day) || localDate(info.onboardedAt, info.tz) >= startDate;
  return nothingToRoll ? round2(await domainScoreOf(tx, userId, domain)) : null;
}

/**
 * The start value at resolution for a user whose start was not known at acceptance: the snapshot of the day before the
 * window; if the user's history has none (a collapsed catch-up), the latest earlier snapshot, else their earliest one,
 * else the live score.
 */
async function startFromHistory(tx: Reader, userId: string, domain: RankedDomain, startDate: string): Promise<number> {
  const day = addDays(startDate, -1);
  const exact = await snapshotScore(tx, userId, domain, day);
  if (exact !== null) return round2(exact);
  const pick = async (order: "latest" | "earliest") => {
    const [snap] = await tx
      .select({ scores: dailySnapshots.scores })
      .from(dailySnapshots)
      .where(order === "latest" ? and(eq(dailySnapshots.userId, userId), lte(dailySnapshots.localDate, day)) : eq(dailySnapshots.userId, userId))
      .orderBy(order === "latest" ? desc(dailySnapshots.localDate) : asc(dailySnapshots.localDate))
      .limit(1);
    const v = (snap?.scores as Partial<Record<string, number>> | undefined)?.[domain];
    return typeof v === "number" ? v : null;
  };
  const found = (await pick("latest")) ?? (await pick("earliest"));
  return round2(found ?? (await domainScoreOf(tx, userId, domain)));
}

/** The user's domain score at the end of `date` (their daily snapshot), or the live score when no snapshot exists. */
async function scoreAtEndOf(tx: Reader, userId: string, domain: RankedDomain, date: string): Promise<number> {
  const [snap] = await tx
    .select({ scores: dailySnapshots.scores })
    .from(dailySnapshots)
    .where(and(eq(dailySnapshots.userId, userId), eq(dailySnapshots.localDate, date)))
    .limit(1);
  const v = (snap?.scores as Partial<Record<string, number>> | undefined)?.[domain];
  return typeof v === "number" ? v : domainScoreOf(tx, userId, domain);
}

/** How the viewer is shown another player: a clanmate (username) or anyone else (public rules). The handle only. */
async function handleFor(tx: Reader, viewerId: string, otherId: string, now: Date): Promise<string> {
  const subject = (await loadProjectionSubjects(tx, [otherId], now)).get(otherId);
  if (!subject) return "OPERATOR";
  return projectUser(subject, (await sameClan(tx, viewerId, otherId)) ? "clanmate" : "public").handle;
}

/**
 * Posts a challenge line to each participant's clan (once when both share one). No scores or gains: only handles,
 * domain and days. The line names players by `{actor}` / `{subject}` placeholders that each clan renders at read time
 * (see renderDispatch): a member of that clan by username, anyone else by the public projection.
 */
export async function postChallengeDispatch(
  tx: Tx,
  c: { challengerId: string; opponentId: string },
  line: { text: string; templateKey?: string; actorId?: string; subjectId?: string },
  now: Date,
): Promise<void> {
  const members = await tx
    .select({ clanId: clanMembers.clanId })
    .from(clanMembers)
    .where(inArray(clanMembers.userId, [c.challengerId, c.opponentId]));
  const clanIds = [...new Set(members.map((m) => m.clanId))].sort();
  for (const clanId of clanIds) {
    await addDispatch(
      tx,
      clanId,
      "challenge",
      line.text,
      now,
      line.templateKey ? { templateKey: line.templateKey, actorId: line.actorId ?? null, subjectId: line.subjectId ?? null } : undefined,
    );
  }
}

/** The dispatch line for a newly accepted challenge: challenger (actor) vs opponent (subject). */
export const challengeStartedLine = (c: { challengerId: string; opponentId: string }, domain: string, days: number) => ({
  text: `CHALLENGE — {actor} vs {subject} — ${domain}, ${days} days.`,
  templateKey: "challenge_started",
  actorId: c.challengerId,
  subjectId: c.opponentId,
});

/**
 * Settles one active challenge. With no `holder` it takes both user locks itself (lowest id first); with a `holder`
 * (a rollover that already owns that user's lock, having rolled through `holder.rolledThrough`) it follows the rule in
 * the file header and may defer. Idempotent: the row is re-read under the locks and only an `active` one resolves.
 * `notices` are the ones created for the holder (the rollover returns them to its caller).
 */
export async function resolveChallenge(
  tx: Tx,
  id: string,
  now: Date,
  holder?: { userId: string; rolledThrough: string },
): Promise<{ result: ResolveResult; notices: Notice[] }> {
  const none = (result: ResolveResult) => ({ result, notices: [] as Notice[] });
  const [seen] = await tx.select().from(namedChallenges).where(eq(namedChallenges.id, id)).limit(1);
  if (!seen || seen.status !== "active") return none("inactive");
  if (!seen.challengerId || !seen.opponentId) {
    const [v] = await tx
      .update(namedChallenges)
      .set({ status: "void", outcome: "void", resolvedAt: now })
      .where(and(eq(namedChallenges.id, id), eq(namedChallenges.status, "active")))
      .returning({ id: namedChallenges.id });
    return none(v ? "void" : "inactive");
  }
  if (!(await lockPair(tx, seen.challengerId, seen.opponentId, holder?.userId))) return none("deferred");

  const [c] = await tx.select().from(namedChallenges).where(eq(namedChallenges.id, id)).for("update");
  if (!c || c.status !== "active") return none("inactive");
  if (!c.challengerId || !c.opponentId) {
    await tx.update(namedChallenges).set({ status: "void", outcome: "void", resolvedAt: now }).where(eq(namedChallenges.id, id));
    return none("void");
  }
  const challengerId = c.challengerId;
  const opponentId = c.opponentId;
  const endDate = c.endDate!;
  const domain = c.domain as RankedDomain;

  // Both players must have rolled the end date (their own local date) so each snapshot of it exists.
  const days = await tx.select().from(userDayState).where(inArray(userDayState.userId, [challengerId, opponentId]));
  const rolled = (userId: string) => {
    const last = days.find((d) => d.userId === userId)?.lastRolledDate ?? null;
    const through = holder?.userId === userId && (last === null || holder.rolledThrough > last) ? holder.rolledThrough : last;
    return through !== null && through >= endDate;
  };
  if (!rolled(challengerId) || !rolled(opponentId)) return none("deferred");

  const challengerEnd = round2(await scoreAtEndOf(tx, challengerId, domain, endDate));
  const opponentEnd = round2(await scoreAtEndOf(tx, opponentId, domain, endDate));
  const challengerStart = c.challengerStart ?? (await startFromHistory(tx, challengerId, domain, c.startDate!));
  const opponentStart = c.opponentStart ?? (await startFromHistory(tx, opponentId, domain, c.startDate!));
  const challengerGain = round2(challengerEnd - challengerStart);
  const opponentGain = round2(opponentEnd - opponentStart);
  const winnerId = challengerGain > opponentGain ? challengerId : challengerGain < opponentGain ? opponentId : null;

  const [done] = await tx
    .update(namedChallenges)
    .set({
      status: "resolved",
      challengerStart,
      opponentStart,
      challengerEnd,
      opponentEnd,
      winnerId,
      outcome: winnerId === null ? "draw" : winnerId === challengerId ? "challenger_won" : "opponent_won",
      resolvedAt: now,
    })
    .where(and(eq(namedChallenges.id, id), eq(namedChallenges.status, "active")))
    .returning({ id: namedChallenges.id });
  if (!done) return none("inactive");

  await postChallengeDispatch(
    tx,
    { challengerId, opponentId },
    winnerId === null
      ? { text: `CHALLENGE RESULT — draw in ${domain}.` }
      : { text: `CHALLENGE RESULT — {actor} took ${domain}.`, templateKey: "challenge_result", actorId: winnerId },
    now,
  );
  const out: Notice[] = [];
  const zones = await tx.select({ id: users.id, tz: users.timezone }).from(users).where(inArray(users.id, [challengerId, opponentId]));
  const sides = [
    { userId: challengerId, otherId: opponentId, myGain: challengerGain, theirGain: opponentGain },
    { userId: opponentId, otherId: challengerId, myGain: opponentGain, theirGain: challengerGain },
  ];
  for (const s of sides) {
    const outcome = winnerId === null ? "draw" : winnerId === s.userId ? "win" : "loss";
    const delta = outcome === "win" ? CHALLENGE_WIN_DELTA : outcome === "loss" ? CHALLENGE_LOSS_DELTA : 0;
    if (delta !== 0) {
      const tz = zones.find((z) => z.id === s.userId)?.tz ?? "UTC";
      const applied = await applyChanges(
        tx,
        s.userId,
        [{ domain: "DISCIPLINE", delta, bonus: false, activity: false, reason: "challenge", refId: id }],
        // The holder's event belongs to the date being rolled (a multi-day catch-up must not stamp wall-clock today).
        { localDate: holder && s.userId === holder.userId ? holder.rolledThrough : localDate(now, tz), now },
      );
      if (s.userId === holder?.userId) out.push(...applied.notices);
    }
    const notice = await insertNotice(
      tx,
      s.userId,
      "challenge_result",
      { challengeId: id, handle: await handleFor(tx, s.userId, s.otherId, now), domain, days: c.days, outcome, myGain: s.myGain, theirGain: s.theirGain, delta },
      now,
    );
    if (s.userId === holder?.userId) out.push(notice);
  }
  return { result: "resolved", notices: out };
}

/** Rollover hook: settles the user's active challenges whose end date is `date` or earlier. Runs inside withUserLock. */
export async function resolveDueForUser(tx: Tx, userId: string, date: string, now: Date): Promise<Notice[]> {
  const due = await tx
    .select({ id: namedChallenges.id })
    .from(namedChallenges)
    .where(
      and(
        eq(namedChallenges.status, "active"),
        lte(namedChallenges.endDate, date),
        or(eq(namedChallenges.challengerId, userId), eq(namedChallenges.opponentId, userId)),
      ),
    )
    .orderBy(asc(namedChallenges.endDate), asc(namedChallenges.createdAt));
  const out: Notice[] = [];
  for (const c of due) out.push(...(await resolveChallenge(tx, c.id, now, { userId, rolledThrough: date })).notices);
  return out;
}

/** Settles one challenge in its own transaction under both user locks (the social job, tests). */
export async function resolveChallengeById(db: Db, id: string, now: Date): Promise<ResolveResult> {
  return db.transaction(async (tx) => (await resolveChallenge(tx, id, now)).result);
}

/**
 * The social job pass: voids challenges of deleted accounts, ignores pending ones past 48 h, then settles active
 * challenges whose window ended before today (UTC; a window ending today is still being played somewhere, and each
 * player's own rollover settles it), rolling both participants first so their end-date snapshots exist. Stops once
 * `budgetMs` of wall time is spent (after at least one challenge); the next tick resumes. Returns the number settled
 * as resolved or void by this pass.
 */
export async function resolveNamedChallenges(
  db: Db,
  now: Date,
  limit = JOB_BATCH,
  opts: { resolve?: typeof resolveChallengeById; budgetMs?: number; nowMs?: () => number } = {},
): Promise<number> {
  const budgetMs = opts.budgetMs ?? env.SOCIAL_JOB_BUDGET_MS;
  const nowMs = opts.nowMs ?? Date.now;
  const started = nowMs();
  await voidOrphans(db, now);
  await expirePending(db, now);
  const utcToday = now.toISOString().slice(0, 10);
  const due = await db
    .select()
    .from(namedChallenges)
    .where(and(eq(namedChallenges.status, "active"), lt(namedChallenges.endDate, utcToday)))
    // Least recently attempted first (never attempted before all): a challenge that keeps deferring goes to the back.
    .orderBy(sql`${namedChallenges.lastAttemptAt} asc nulls first`, asc(namedChallenges.endDate), asc(namedChallenges.createdAt))
    .limit(limit);
  let settled = 0;
  for (const [i, c] of due.entries()) {
    try {
      await db.update(namedChallenges).set({ lastAttemptAt: now }).where(eq(namedChallenges.id, c.id));
      for (const userId of [c.challengerId, c.opponentId]) if (userId) await ensureRolledOver(db, userId, now);
      const r = await (opts.resolve ?? resolveChallengeById)(db, c.id, now);
      if (r === "resolved" || r === "void") settled++;
    } catch (err) {
      logger.error({ err, challengeId: c.id }, "Challenge resolution failed");
    }
    if (nowMs() - started >= budgetMs && i < due.length - 1) {
      logger.info({ settled, pending: due.length - i - 1 }, "Challenge resolution stopped at its time budget");
      break;
    }
  }
  return settled;
}

// --- reads -----------------------------------------------------------------------------------------

/** A resolved challenge's result for one side, from the stored outcome (rows resolved before it existed: the winner id). */
function viewerOutcome(r: NamedChallenge, isChallenger: boolean): "win" | "loss" | "draw" {
  const o = r.outcome ?? (r.winnerId === null ? "draw" : r.winnerId === r.challengerId ? "challenger_won" : "opponent_won");
  if (o === "challenger_won") return isChallenger ? "win" : "loss";
  if (o === "opponent_won") return isChallenger ? "loss" : "win";
  return "draw";
}

/** The challenges as `viewerId` sees them (contract shape). Handles come from projectUser; numbers are domain gains only. */
export async function toChallengeDtos(db: Reader, viewerId: string, rows: readonly NamedChallenge[], now: Date): Promise<Challenge[]> {
  if (rows.length === 0) return [];
  const otherOf = (r: NamedChallenge) => (r.challengerId === viewerId ? r.opponentId : r.challengerId);
  const others = [...new Set(rows.flatMap((r) => (otherOf(r) ? [otherOf(r)!] : [])))];
  const subjects = await loadProjectionSubjects(db, others, now);
  const mine = others.length > 0 ? await db.select().from(clanMembers).where(inArray(clanMembers.userId, [viewerId, ...others])) : [];
  const myClan = mine.find((m) => m.userId === viewerId)?.clanId;
  const live = await db
    .select()
    .from(domainScores)
    .where(inArray(domainScores.userId, [viewerId, ...others]));
  const liveScore = (userId: string, domain: string) => live.find((s) => s.userId === userId && s.domain === domain)?.score ?? 0;

  // A start still waiting for its owner's snapshot shows once that snapshot exists (never a live guess).
  const previews = new Map<string, { challenger: number | null; opponent: number | null }>();
  for (const r of rows) {
    if (r.status !== "active" || !r.startDate || !r.challengerId || !r.opponentId) continue;
    if (r.challengerStart !== null && r.opponentStart !== null) continue;
    const day = addDays(r.startDate, -1);
    const domain = r.domain as RankedDomain;
    const c = r.challengerStart ?? (await snapshotScore(db, r.challengerId, domain, day));
    const o = r.opponentStart ?? (await snapshotScore(db, r.opponentId, domain, day));
    previews.set(r.id, { challenger: c === null ? null : round2(c), opponent: o === null ? null : round2(o) });
  }

  return rows.map((r): Challenge => {
    const isChallenger = r.challengerId === viewerId;
    const otherId = otherOf(r);
    const subject = otherId ? subjects.get(otherId) : undefined;
    const clanmate = !!myClan && !!otherId && mine.some((m) => m.userId === otherId && m.clanId === myClan);
    const profile = subject ? projectUser(subject, clanmate ? "clanmate" : "public") : null;
    const preview = previews.get(r.id);
    const challengerStart = r.challengerStart ?? preview?.challenger ?? null;
    const opponentStart = r.opponentStart ?? preview?.opponent ?? null;
    const myStart = isChallenger ? challengerStart : opponentStart;
    const theirStart = isChallenger ? opponentStart : challengerStart;
    const myEnd = isChallenger ? r.challengerEnd : r.opponentEnd;
    const theirEnd = isChallenger ? r.opponentEnd : r.challengerEnd;
    let myGain: number | null = null;
    let theirGain: number | null = null;
    if (r.status === "active" && myStart !== null && theirStart !== null && otherId) {
      myGain = round2(liveScore(viewerId, r.domain) - myStart);
      theirGain = round2(liveScore(otherId, r.domain) - theirStart);
    } else if (r.status === "resolved" && myStart !== null && theirStart !== null && myEnd !== null && theirEnd !== null) {
      myGain = round2(myEnd - myStart);
      theirGain = round2(theirEnd - theirStart);
    }
    return {
      id: r.id,
      role: isChallenger ? "challenger" : "opponent",
      opponent: { handle: profile?.handle ?? null, isCodename: profile?.isCodename ?? false },
      domain: r.domain as RankedDomain,
      days: r.days as 3 | 7 | 14 | 30,
      status: r.status as Challenge["status"],
      createdAt: r.createdAt.toISOString(),
      respondBy: r.respondBy.toISOString(),
      startDate: r.startDate,
      endDate: r.endDate,
      myGain,
      theirGain,
      outcome: r.status === "resolved" ? viewerOutcome(r, isChallenger) : null,
      line: isChallenger && r.status === "ignored" ? CHALLENGE_IGNORED_LINE : null,
    };
  });
}

/** The viewer's open challenges plus the most recent closed ones, newest first. */
export async function listChallenges(db: Db, viewerId: string, now: Date): Promise<Challenge[]> {
  await voidOrphans(db, now, viewerId);
  await expirePending(db, now, viewerId);
  const mineWhere = or(eq(namedChallenges.challengerId, viewerId), eq(namedChallenges.opponentId, viewerId));
  const open = await db
    .select()
    .from(namedChallenges)
    .where(and(mineWhere, inArray(namedChallenges.status, [...OPEN_STATUSES])))
    .orderBy(desc(namedChallenges.createdAt));
  const closed = await db
    .select()
    .from(namedChallenges)
    .where(and(mineWhere, inArray(namedChallenges.status, ["ignored", "resolved", "void"])))
    .orderBy(desc(namedChallenges.createdAt))
    .limit(CLOSED_LISTED);
  return toChallengeDtos(db, viewerId, [...open, ...closed], now);
}

