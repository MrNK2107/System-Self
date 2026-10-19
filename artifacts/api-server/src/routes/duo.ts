import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, gt, or } from "drizzle-orm";
import { duoCheckins, duoInvites, duoMembers, duos, users, type Db } from "@workspace/db";
import {
  DUO_MAX_OUTGOING_INVITES,
  DUO_NUDGES_PER_DAY,
  DuoActionRequestSchema,
  DuoCheckinRequestSchema,
  DuoInviteRequestSchema,
  type DuoCheckinItem,
  type DuoInviteItem,
} from "@workspace/contracts";
import { localDate } from "@workspace/engine";
import { z } from "zod";
import { track } from "../services/analytics";
import { cancelOpenInvites, dissolveDuoOf, duoOf, duoView } from "../services/duo";
import { withIdempotency, type HandlerResult } from "../services/idempotency";
import { loadProjectionSubjects, projectUser } from "../services/projection";
import { insertNotice } from "../services/scoring";
import { isBlockedEitherWay, resolveHandle } from "../services/social";

const IdSchema = z.string().uuid();
const DAY_MS = 86_400_000;

const err = (status: number, code: string, error: string): HandlerResult => ({ status, body: { error, code } });
const notFound = () => err(404, "not_found", "Player not found");
const inviteNotFound = () => err(404, "not_found", "Invite not found");
const notPending = () => err(409, "not_pending", "This invite is no longer open");
const alreadyInDuo = () => err(409, "already_in_duo", "A duo is already formed");
const notInDuo = () => err(404, "not_in_duo", "You are not in a duo");

const pgCode = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x.cause?.code ?? x.code;
};

export function duoRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  /** The partner (duo projection), the pair's check-ins of the last 7 days and the open invites. */
  router.get("/duo", async (req, res) => {
    res.json(await duoView(db, req.user!.id, clock()));
  });

  /** Invites a player by handle. Resolves like follow (public username, or any codename); a block answers as an unknown handle. */
  router.post("/duo/invite", async (req, res) => {
    const body = DuoInviteRequestSchema.parse(req.body ?? {});
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /duo/invite", async (tx) => {
      const now = clock();
      if (await duoOf(tx, me)) return alreadyInDuo();
      const target = await resolveHandle(tx, me, body.username);
      if (!target) return notFound();
      if (target.self) return err(400, "self_target", "You cannot invite yourself");
      if (await isBlockedEitherWay(tx, me, target.userId)) return notFound();
      if (await duoOf(tx, target.userId)) return alreadyInDuo();
      const open = await tx
        .select({ fromId: duoInvites.fromId, toId: duoInvites.toId })
        .from(duoInvites)
        .where(and(eq(duoInvites.status, "pending"), or(eq(duoInvites.fromId, me), eq(duoInvites.toId, me))));
      if (open.some((i) => (i.fromId === me && i.toId === target.userId) || (i.fromId === target.userId && i.toId === me))) {
        return err(409, "invite_open", "An invite between you is already open");
      }
      if (open.filter((i) => i.fromId === me).length >= DUO_MAX_OUTGOING_INVITES) {
        return err(409, "invite_limit", `At most ${DUO_MAX_OUTGOING_INVITES} open invites`);
      }
      const [row] = await tx.insert(duoInvites).values({ fromId: me, toId: target.userId, createdAt: now }).returning();
      const subject = (await loadProjectionSubjects(tx, [target.userId], now)).get(target.userId);
      const p = subject ? projectUser(subject, "public") : null;
      const dto: DuoInviteItem = {
        id: row!.id,
        direction: "outgoing",
        handle: p?.handle ?? "OPERATOR",
        isCodename: p?.isCodename ?? true,
        createdAt: row!.createdAt.toISOString(),
      };
      await track(tx, me, "duo_invited", {});
      return { status: 201, body: dto };
    });
  });

  const answer = (verb: "accept" | "decline") => async (req: Request, res: Response) => {
    DuoActionRequestSchema.parse(req.body ?? {});
    const id = IdSchema.safeParse(req.params.id);
    const me = req.user!.id;
    if (!id.success) return void res.status(404).json(inviteNotFound().body);
    await withIdempotency(db, req, res, `POST /duo/invites/${id.data}/${verb}`, async (tx) => {
      const now = clock();
      const [inv] = await tx
        .select()
        .from(duoInvites)
        .where(and(eq(duoInvites.id, id.data), eq(duoInvites.toId, me)))
        .limit(1);
      if (!inv) return inviteNotFound();
      if (inv.status !== "pending") return notPending();
      if (verb === "decline") {
        await tx.update(duoInvites).set({ status: "declined" }).where(and(eq(duoInvites.id, inv.id), eq(duoInvites.status, "pending")));
        return { status: 200, body: await duoView(tx, me, now) };
      }
      if (await isBlockedEitherWay(tx, me, inv.fromId)) {
        await tx.update(duoInvites).set({ status: "cancelled" }).where(eq(duoInvites.id, inv.id));
        return notPending();
      }
      if ((await duoOf(tx, me)) || (await duoOf(tx, inv.fromId))) return alreadyInDuo();
      // The primary key on duo_members is the arbiter: a crossing accept by the other side loses here, whole.
      try {
        await tx.transaction(async (sp) => {
          const [duo] = await sp.insert(duos).values({ userA: inv.fromId, userB: me, createdAt: now }).returning({ id: duos.id });
          // Ascending id order, so two crossing accepts cannot deadlock on each other's member rows.
          for (const userId of [inv.fromId, me].sort()) await sp.insert(duoMembers).values({ userId, duoId: duo!.id });
        });
      } catch (e) {
        if (pgCode(e) === "23505") return alreadyInDuo();
        throw e;
      }
      await tx.update(duoInvites).set({ status: "accepted" }).where(eq(duoInvites.id, inv.id));
      await cancelOpenInvites(tx, [inv.fromId, me]);
      await track(tx, me, "duo_formed", {});
      return { status: 200, body: await duoView(tx, me, now) };
    });
  };
  router.post("/duo/invites/:id/accept", answer("accept"));
  router.post("/duo/invites/:id/decline", answer("decline"));

  /** Leaving dissolves the duo for both. */
  router.post("/duo/leave", async (req, res) => {
    DuoActionRequestSchema.parse(req.body ?? {});
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /duo/leave", async (tx) => {
      if (!(await dissolveDuoOf(tx, me))) return notInDuo();
      return { status: 204, body: null };
    });
  });

  /** A check-in for the partner. `going_now` is a nudge: at most 3 per local day per sender. No score effect. */
  router.post("/duo/checkin", async (req, res) => {
    const body = DuoCheckinRequestSchema.parse(req.body ?? {});
    const me = req.user!.id;
    await withIdempotency(db, req, res, "POST /duo/checkin", async (tx) => {
      const now = clock();
      const mine = await duoOf(tx, me);
      if (!mine) return notInDuo();
      const [u] = await tx.select({ tz: users.timezone, username: users.username }).from(users).where(eq(users.id, me)).limit(1);
      const tz = u?.tz ?? "UTC";
      if (body.kind === "going_now") {
        // Counted per local day of the sender (the 48 h window only bounds the scan).
        const today = localDate(now, tz);
        const recent = await tx
          .select({ at: duoCheckins.createdAt })
          .from(duoCheckins)
          .where(and(eq(duoCheckins.userId, me), eq(duoCheckins.kind, "going_now"), gt(duoCheckins.createdAt, new Date(now.getTime() - 2 * DAY_MS))));
        if (recent.filter((r) => localDate(r.at, tz) === today).length >= DUO_NUDGES_PER_DAY) {
          return err(429, "nudge_limit", `At most ${DUO_NUDGES_PER_DAY} nudges a day`);
        }
      }
      let row;
      try {
        [row] = await tx.transaction((sp) =>
          sp.insert(duoCheckins).values({ duoId: mine.duoId, userId: me, kind: body.kind, createdAt: now }).returning(),
        );
      } catch (e) {
        // The partner left (the duo is gone) between the lookup and the insert.
        if (pgCode(e) === "23503") return notInDuo();
        throw e;
      }
      await insertNotice(tx, mine.partnerId, "duo_checkin", { handle: u?.username ?? "OPERATOR", kind: body.kind }, now);
      await track(tx, me, "duo_checkin", { kind: body.kind });
      const dto: DuoCheckinItem = { id: row!.id, kind: body.kind, fromMe: true, createdAt: row!.createdAt.toISOString() };
      return { status: 201, body: dto };
    });
  });

  return router;
}
