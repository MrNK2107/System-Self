import { Router, type IRouter } from "express";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { clanMembers, clans, users, type Db } from "@workspace/db";
import {
  CLAN_MAX_MEMBERS,
  ClanCreateRequestSchema,
  ClanJoinCodeRequestSchema,
  ClanLeaderboardQuerySchema,
  ClanLeaderRequestSchema,
  ClanSearchQuerySchema,
  type MyClanResponse,
} from "@workspace/contracts";
import { z } from "zod";
import { requirePro } from "../services/entitlements";
import { withIdempotency, type HandlerResult } from "../services/idempotency";
import {
  addDispatch,
  blockedWithMember,
  clanMembersView,
  isDeadWeight,
  isRemovable,
  lockClan,
  membershipOf,
  newInviteCode,
  recentDispatches,
  syncClanStatus,
  toClanDto,
  toLeaderboardItems,
  toSummaries,
} from "../services/clans";
import type { Tx } from "../services/user-lock";

const IdSchema = z.string().uuid();
const SEARCH_LIMIT = 20;
const INVITE_ATTEMPTS = 5;

const err = (status: number, code: string, error: string): HandlerResult => ({ status, body: { error, code } });
const noContent = (): HandlerResult => ({ status: 204, body: null });
const notFound = () => err(404, "not_found", "Clan not found");
const alreadyInClan = () => err(409, "already_in_clan", "Already in a clan");
const notInClan = () => err(409, "not_in_clan", "Not in a clan");
const notLeader = () => err(403, "not_leader", "Only the clan leader can do this");
const memberNotFound = () => err(404, "not_found", "Member not found");

/** `%`, `_` and `\` in user input match literally in a LIKE pattern. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Re-checked under the clan lock: the role read before the lock may be stale (e.g. the daily repair). */
const stillLeader = async (tx: Tx, userId: string, clanId: string) => {
  const m = await membershipOf(tx, userId);
  return !!m && m.clanId === clanId && m.role === "leader";
};

const usernameOf = async (tx: Pick<Tx, "select">, userId: string) =>
  (await tx.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1))[0]?.username ?? "operator";

/** True for a unique violation of `constraint` (drizzle wraps the pg error in `cause`). */
function uniqueViolation(e: unknown, constraint: string): boolean {
  const x = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return (x.cause?.code ?? x.code) === "23505" && (x.cause?.constraint ?? x.constraint) === constraint;
}

/**
 * Adds `me` to the clan. The clan row is locked FOR UPDATE, so concurrent joins of one clan count members one at a
 * time and the clan never passes 30. One clan per user (clan_members is keyed by user).
 */
async function joinClan(tx: Tx, me: string, clanId: string, now: Date): Promise<HandlerResult> {
  if (await membershipOf(tx, me)) return alreadyInClan();
  const clan = await lockClan(tx, clanId);
  if (!clan) return notFound();
  const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(clanMembers).where(eq(clanMembers.clanId, clan.id))) as [{ n: number }];
  if (n >= CLAN_MAX_MEMBERS) return err(409, "clan_full", "Clan is full");
  if (await blockedWithMember(tx, me, clan.id)) return err(403, "blocked", "Blocked");
  await tx.insert(clanMembers).values({ userId: me, clanId: clan.id, role: "member", joinedAt: now });
  await addDispatch(tx, clan.id, "joined", `OPERATOR ${await usernameOf(tx, me)} JOINED. Roster: ${n + 1}.`, now);
  await syncClanStatus(tx, clan, now);
  return noContent();
}

export function clansRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  /** Founds a clan (PRO + verified email); the creator leads it. */
  router.post("/clans", requirePro(db, clock), async (req, res) => {
    const body = ClanCreateRequestSchema.parse(req.body ?? {});
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /clans", async (tx) => {
      const now = clock();
      const [u] = await tx.select({ verified: users.emailVerifiedAt, username: users.username }).from(users).where(eq(users.id, me)).limit(1);
      if (!u?.verified) return err(403, "email_unverified", "Verify your email to found a clan");
      if (await membershipOf(tx, me)) return alreadyInClan();
      // Inserts run in savepoints so a unique violation answers 409 (or retries the code) instead of aborting.
      let created = null;
      for (let attempt = 0; attempt < INVITE_ATTEMPTS && !created; attempt++) {
        try {
          created = await tx.transaction(async (sp) => {
            const [row] = await sp
              .insert(clans)
              .values({
                name: body.name,
                nameLower: body.name.toLowerCase(),
                tag: body.tag,
                description: body.description ? body.description : null,
                createdBy: me,
                createdAt: now,
                inviteCode: newInviteCode(),
              })
              .returning();
            return row!;
          });
        } catch (e) {
          if (uniqueViolation(e, "clans_name_lower_uq")) return err(409, "name_taken", "Clan name already taken");
          if (!uniqueViolation(e, "clans_invite_code_uq")) throw e;
        }
      }
      if (!created) throw new Error("could not allocate an invite code");
      await tx.insert(clanMembers).values({ userId: me, clanId: created.id, role: "leader", joinedAt: now });
      await addDispatch(tx, created.id, "founded", `CLAN ${created.name} [${created.tag}] FOUNDED BY ${u.username}. Forming. 8 operators required.`, now);
      return { status: 201, body: await toClanDto(tx, created, "leader") };
    });
  });

  /** Clans by name or tag (empty q: by rank). Anyone may see a clan's name, tag, size, status and rank. */
  router.get("/clans/search", async (req, res) => {
    const { q } = ClanSearchQuerySchema.parse(req.query);
    const needle = escapeLike(q.toLowerCase());
    const rows = await db
      .select()
      .from(clans)
      .where(q ? sql`(${clans.nameLower} like ${`%${needle}%`} escape '\\' or lower(${clans.tag}) like ${`${needle}%`} escape '\\')` : undefined)
      .orderBy(sql`${clans.clanRank} asc nulls last`, asc(clans.nameLower))
      .limit(SEARCH_LIMIT);
    res.json({ items: await toSummaries(db, rows) });
  });

  /** Ranked (active) clans by global clan rank. */
  router.get("/clans/leaderboard", async (req, res) => {
    const { limit } = ClanLeaderboardQuerySchema.parse(req.query);
    const rows = await db
      .select()
      .from(clans)
      .where(and(eq(clans.status, "active"), isNotNull(clans.clanRank)))
      .orderBy(asc(clans.clanRank))
      .limit(limit);
    res.json({ items: await toLeaderboardItems(db, rows) });
  });

  /** The viewer's clan with its members (clanmate projection), the last 10 dispatches and the current raid. */
  router.get("/clans/mine", async (req, res) => {
    const me = req.user!.id;
    const now = clock();
    const empty: MyClanResponse = { clan: null, members: [], dispatches: [], raid: null };
    const m = await membershipOf(db, me);
    if (!m) return void res.json(empty);
    const [clan] = await db.select().from(clans).where(eq(clans.id, m.clanId)).limit(1);
    if (!clan) return void res.json(empty);
    const body: MyClanResponse = {
      clan: await toClanDto(db, clan, m.role as "leader" | "member"),
      members: await clanMembersView(db, clan.id, me, now),
      dispatches: await recentDispatches(db, clan.id),
      raid: null,
    };
    res.json(body);
  });

  router.post("/clans/join", async (req, res) => {
    const { inviteCode } = ClanJoinCodeRequestSchema.parse(req.body ?? {});
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /clans/join", async (tx) => {
      const [clan] = await tx.select({ id: clans.id }).from(clans).where(eq(clans.inviteCode, inviteCode.toUpperCase())).limit(1);
      if (!clan) return (await membershipOf(tx, me)) ? alreadyInClan() : err(404, "not_found", "Invite code not recognised");
      return joinClan(tx, me, clan.id, clock());
    });
  });

  /** A member leaves. The leader can only leave last (the clan disbands) or after transferring leadership. */
  router.post("/clans/leave", async (req, res) => {
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /clans/leave", async (tx) => {
      const now = clock();
      const before = await membershipOf(tx, me);
      if (!before) return notInClan();
      const clan = await lockClan(tx, before.clanId);
      if (!clan) return notInClan();
      // Re-read under the clan lock: a transfer or removal may have committed while this request waited for it.
      const m = await membershipOf(tx, me);
      if (!m || m.clanId !== clan.id) return notInClan();
      if (m.role === "leader") {
        const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(clanMembers).where(eq(clanMembers.clanId, clan.id))) as [{ n: number }];
        if (n > 1) return err(409, "leader_must_transfer", "Transfer leadership before leaving");
        await tx.delete(clans).where(eq(clans.id, clan.id));
        return noContent();
      }
      await tx.delete(clanMembers).where(eq(clanMembers.userId, me));
      await addDispatch(tx, clan.id, "left", `OPERATOR ${await usernameOf(tx, me)} LEFT THE CLAN.`, now);
      await syncClanStatus(tx, clan, now);
      return noContent();
    });
  });

  /** The leader removes a member flagged as dead weight (still inactive). Non-flagged members can't be kicked. */
  router.post("/clans/members/:userId/remove", async (req, res) => {
    const target = IdSchema.safeParse(req.params.userId);
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /clans/members/remove", async (tx) => {
      const now = clock();
      const m = await membershipOf(tx, me);
      if (!m) return notInClan();
      if (m.role !== "leader") return notLeader();
      if (!target.success) return memberNotFound();
      if (target.data === me) return err(400, "self_target", "The leader cannot remove themselves");
      const clan = await lockClan(tx, m.clanId);
      if (!clan) return notInClan();
      if (!(await stillLeader(tx, me, clan.id))) return notLeader();
      const [t] = await tx
        .select()
        .from(clanMembers)
        .where(and(eq(clanMembers.userId, target.data), eq(clanMembers.clanId, clan.id)))
        .limit(1);
      if (!t) return memberNotFound();
      if (!t.flaggedAt) return err(409, "not_flagged", "Only members flagged as dead weight can be removed");
      if (!(await isRemovable(tx, t.userId, now))) {
        // Active again in the window (or not in the clan for all of it): the flag no longer holds. A member who
        // only logged today keeps the flag (the window ends yesterday) but cannot be removed today.
        if (!(await isDeadWeight(tx, t.userId, now))) await tx.update(clanMembers).set({ flaggedAt: null }).where(eq(clanMembers.userId, t.userId));
        return err(409, "not_flagged", "Only members flagged as dead weight can be removed");
      }
      await tx.delete(clanMembers).where(eq(clanMembers.userId, t.userId));
      await addDispatch(tx, clan.id, "removed", `OPERATOR ${await usernameOf(tx, t.userId)} REMOVED. Dead weight.`, now);
      await syncClanStatus(tx, clan, now);
      return noContent();
    });
  });

  /** The leader hands leadership to another member and becomes a member. */
  router.post("/clans/leader", async (req, res) => {
    const { userId } = ClanLeaderRequestSchema.parse(req.body ?? {});
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /clans/leader", async (tx) => {
      const now = clock();
      const m = await membershipOf(tx, me);
      if (!m) return notInClan();
      if (m.role !== "leader") return notLeader();
      if (userId === me) return err(400, "self_target", "Already the leader");
      const clan = await lockClan(tx, m.clanId);
      if (!clan) return notInClan();
      if (!(await stillLeader(tx, me, clan.id))) return notLeader();
      const [t] = await tx
        .select()
        .from(clanMembers)
        .where(and(eq(clanMembers.userId, userId), eq(clanMembers.clanId, clan.id)))
        .limit(1);
      if (!t) return memberNotFound();
      // Demote first: the partial unique index allows one leader per clan.
      await tx.update(clanMembers).set({ role: "member" }).where(eq(clanMembers.userId, me));
      await tx.update(clanMembers).set({ role: "leader" }).where(eq(clanMembers.userId, userId));
      await addDispatch(tx, clan.id, "leader", `LEADERSHIP TRANSFERRED TO ${await usernameOf(tx, userId)}.`, now);
      return noContent();
    });
  });

  router.post("/clans/:id/join", async (req, res) => {
    const id = IdSchema.safeParse(req.params.id);
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /clans/:id/join", async (tx) => {
      if (!id.success) return notFound();
      return joinClan(tx, me, id.data, clock());
    });
  });

  return router;
}
