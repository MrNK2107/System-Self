import { Router, type IRouter } from "express";
import { and, count, desc, eq, ne, or, sql } from "drizzle-orm";
import { blocks, follows, profiles, userReports, users, type Db } from "@workspace/db";
import { SocialHandleSchema, SocialSearchQuerySchema, UserReportRequestSchema } from "@workspace/contracts";
import type { PublicProfile } from "@workspace/contracts";
import { localDate } from "@workspace/engine";
import { withIdempotency, type HandlerResult } from "../services/idempotency";
import { loadProjectionSubjects, projectUser, type Relation } from "../services/projection";
import { isBlockedEitherWay, resolveHandle } from "../services/social";

const SEARCH_LIMIT = 20;
const FOLLOWING_LIMIT = 200;
/** Reports one player may file per local day. */
export const REPORTS_PER_DAY = 10;
/** The fixed first part of every public codename; search matches the word part after it. */
const CODENAME_PREFIX_LEN = "USER // ".length;

const notFound = (): HandlerResult => ({ status: 404, body: { error: "Player not found", code: "not_found" } });
const noContent = (): HandlerResult => ({ status: 204, body: null });

/** `%`, `_` and `\` in user input match literally in a LIKE pattern. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** SQL: no block between `me` and the player in `other`, in either direction (covers a follow/block race). */
const notBlocked = (me: string, other: unknown) =>
  sql`not exists (select 1 from ${blocks} b where (b.blocker_id = ${me} and b.blocked_id = ${other}) or (b.blocker_id = ${other} and b.blocked_id = ${me}))`;

export function socialRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  /**
   * Public players by username prefix; semi-public players only by the word part of their codename ("BOLT-3" of
   * "USER // BOLT-3"), so a semi-public username never matches (no username-to-codename oracle). Anonymous
   * players are never listed. Codename hits are ordered by codename, public hits by username.
   */
  router.get("/social/search", async (req, res) => {
    const { q } = SocialSearchQuerySchema.parse(req.query);
    const me = req.user!.id;
    const pattern = `${escapeLike(q.toLowerCase())}%`;
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(
        and(
          ne(users.id, me),
          or(
            and(eq(profiles.identitySetting, "public"), sql`lower(${users.username}) like ${pattern} escape '\\'`),
            and(
              eq(profiles.identitySetting, "semi-public"),
              sql`lower(substr(${profiles.publicCodename}, ${CODENAME_PREFIX_LEN + 1})) like ${pattern} escape '\\'`,
            ),
          ),
          sql`not exists (select 1 from ${blocks} b where (b.blocker_id = ${me} and b.blocked_id = ${users.id}) or (b.blocker_id = ${users.id} and b.blocked_id = ${me}))`,
        ),
      )
      .orderBy(
        sql`case when ${profiles.identitySetting} = 'public' then lower(${users.username}) else lower(${profiles.publicCodename}) end`,
        users.id,
      )
      .limit(SEARCH_LIMIT);
    const subjects = await loadProjectionSubjects(db, rows.map((r) => r.id), clock());
    const out: PublicProfile[] = [];
    for (const r of rows) {
      const s = subjects.get(r.id);
      if (s) out.push(projectUser(s, "public"));
    }
    res.json(out);
  });

  /** One player as the viewer may see them: self, a followed player, or a stranger. */
  router.get("/social/profile/:handle", async (req, res) => {
    const handle = SocialHandleSchema.parse(req.params.handle);
    const me = req.user!.id;
    const target = await resolveHandle(db, me, handle);
    if (!target) return void res.status(404).json(notFound().body);
    let relation: Relation = "self";
    let following = false;
    if (!target.self) {
      if (await isBlockedEitherWay(db, me, target.userId)) return void res.status(404).json(notFound().body);
      const [f] = await db
        .select({ id: follows.followeeId })
        .from(follows)
        .where(and(eq(follows.followerId, me), eq(follows.followeeId, target.userId)))
        .limit(1);
      following = !!f;
      // Anonymous players are only visible to someone already following them (by the codename they follow).
      if (target.identitySetting === "anonymous" && !following) return void res.status(404).json(notFound().body);
      relation = following ? "follower" : "public";
    }
    const subject = (await loadProjectionSubjects(db, [target.userId], clock())).get(target.userId);
    if (!subject) return void res.status(404).json(notFound().body);
    res.json({ profile: projectUser(subject, relation), following, isSelf: target.self });
  });

  router.post("/social/follow/:handle", async (req, res) => {
    const handle = SocialHandleSchema.parse(req.params.handle);
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /social/follow", async (tx) => {
      const target = await resolveHandle(tx, me, handle);
      if (!target) return notFound();
      if (target.self) return { status: 400, body: { error: "You cannot follow yourself", code: "self_target" } };
      if (target.identitySetting === "anonymous") return notFound();
      if (await isBlockedEitherWay(tx, me, target.userId)) {
        return { status: 403, body: { error: "Blocked", code: "blocked" } };
      }
      await tx.insert(follows).values({ followerId: me, followeeId: target.userId }).onConflictDoNothing();
      return noContent();
    });
  });

  router.delete("/social/follow/:handle", async (req, res) => {
    const handle = SocialHandleSchema.parse(req.params.handle);
    const me = req.user!.id;
    await withIdempotency(db, req, res, "DELETE /social/follow", async (tx) => {
      const target = await resolveHandle(tx, me, handle);
      if (target && !target.self) {
        await tx.delete(follows).where(and(eq(follows.followerId, me), eq(follows.followeeId, target.userId)));
      }
      return noContent();
    });
  });

  /** Players the viewer follows, as a follower sees them (rank, trajectory, shadow only). */
  router.get("/social/following", async (req, res) => {
    const me = req.user!.id;
    const rows = await db
      .select({ id: follows.followeeId })
      .from(follows)
      .where(and(eq(follows.followerId, me), notBlocked(me, follows.followeeId)))
      .orderBy(desc(follows.createdAt), follows.followeeId)
      .limit(FOLLOWING_LIMIT);
    const subjects = await loadProjectionSubjects(db, rows.map((r) => r.id), clock());
    const out: PublicProfile[] = [];
    for (const r of rows) {
      const s = subjects.get(r.id);
      if (s) out.push(projectUser(s, "follower"));
    }
    res.json(out);
  });

  router.get("/social/followers/count", async (req, res) => {
    const me = req.user!.id;
    const [row] = await db
      .select({ n: count() })
      .from(follows)
      .where(and(eq(follows.followeeId, me), notBlocked(me, follows.followerId)));
    res.json({ count: row?.n ?? 0 });
  });

  // Block and report resolve any player by public codename, anonymous included: a codename is not linked to
  // identity (it never reveals the username), so answering 204/201 for it is not a leak.
  router.post("/social/block/:userRef", async (req, res) => {
    const handle = SocialHandleSchema.parse(req.params.userRef);
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /social/block", async (tx) => {
      const target = await resolveHandle(tx, me, handle);
      if (!target) return notFound();
      if (target.self) return { status: 400, body: { error: "You cannot block yourself", code: "self_target" } };
      await tx.insert(blocks).values({ blockerId: me, blockedId: target.userId }).onConflictDoNothing();
      // Blocking severs follows in both directions.
      await tx
        .delete(follows)
        .where(
          or(
            and(eq(follows.followerId, me), eq(follows.followeeId, target.userId)),
            and(eq(follows.followerId, target.userId), eq(follows.followeeId, me)),
          ),
        );
      return noContent();
    });
  });

  router.delete("/social/block/:userRef", async (req, res) => {
    const handle = SocialHandleSchema.parse(req.params.userRef);
    const me = req.user!.id;
    await withIdempotency(db, req, res, "DELETE /social/block", async (tx) => {
      const target = await resolveHandle(tx, me, handle);
      if (!target) return notFound();
      if (target.self) return { status: 400, body: { error: "You cannot unblock yourself", code: "self_target" } };
      await tx.delete(blocks).where(and(eq(blocks.blockerId, me), eq(blocks.blockedId, target.userId)));
      return noContent();
    });
  });

  router.post("/social/report", async (req, res) => {
    const body = UserReportRequestSchema.parse(req.body);
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /social/report", async (tx) => {
      const target = await resolveHandle(tx, me, body.subject);
      if (!target) return notFound();
      if (target.self) return { status: 400, body: { error: "You cannot report yourself", code: "self_target" } };
      const now = clock();
      const [u] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, me));
      const today = localDate(now, u!.tz);
      const recent = await tx
        .select({ at: userReports.createdAt })
        .from(userReports)
        .where(and(eq(userReports.reporterId, me), sql`${userReports.createdAt} > ${new Date(now.getTime() - 48 * 3_600_000)}`));
      if (recent.filter((r) => localDate(r.at, u!.tz) === today).length >= REPORTS_PER_DAY) {
        return { status: 429, body: { error: "Report limit reached for today", code: "report_limit" } };
      }
      // One open report per (reporter, subject) is enforced by the partial unique index user_reports_open_uq;
      // the insert runs in a savepoint so its violation answers 409 instead of aborting the transaction.
      try {
        const [row] = await tx.transaction((sp) =>
          sp
            .insert(userReports)
            .values({ reporterId: me, subjectId: target.userId, reason: body.reason, createdAt: now })
            .returning({ id: userReports.id }),
        );
        return { status: 201, body: { id: row!.id } };
      } catch (err) {
        const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
        if ((e.cause?.code ?? e.code) === "23505" && (e.cause?.constraint ?? e.constraint) === "user_reports_open_uq") {
          return { status: 409, body: { error: "Already reported", code: "already_reported" } };
        }
        throw err;
      }
    });
  });

  return router;
}
