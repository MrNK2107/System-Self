/**
 * Party of Two (PRD 16, design 3.4). One duo per user (duo_members.user_id is the key, so concurrent accepts cannot
 * give a user two duos), usernames visible to each other, check-ins with a nudge limit, and no score effect:
 * nothing here ever calls applyChanges.
 */
import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import { blocks, duoCheckins, duoInvites, duoMembers, duos, type Db } from "@workspace/db";
import { DUO_CHECKIN_DAYS, type DuoCheckinItem, type DuoInviteItem, type DuoResponse } from "@workspace/contracts";
import { loadProjectionSubjects, projectUser } from "./projection";

type Reader = Pick<Db, "select">;

const DAY_MS = 86_400_000;
/** Check-ins returned to the pair (the last 7 days, newest first); the cap bounds a spammy pair. */
const CHECKINS_LISTED = 100;

/** The user's duo and partner, or null. */
export async function duoOf(db: Reader, userId: string): Promise<{ duoId: string; partnerId: string } | null> {
  const [m] = await db
    .select({ duoId: duoMembers.duoId, a: duos.userA, b: duos.userB })
    .from(duoMembers)
    .innerJoin(duos, eq(duos.id, duoMembers.duoId))
    .where(eq(duoMembers.userId, userId))
    .limit(1);
  return m ? { duoId: m.duoId, partnerId: m.a === userId ? m.b : m.a } : null;
}

/** Dissolves the duo the user is in (members and check-ins cascade). True when there was one. */
export async function dissolveDuoOf(tx: Pick<Db, "select" | "delete">, userId: string): Promise<boolean> {
  const mine = await duoOf(tx, userId);
  if (!mine) return false;
  await tx.delete(duos).where(eq(duos.id, mine.duoId));
  return true;
}

/** Dissolves the duo of `a` when `b` is its partner (a block between them). */
export async function dissolveBetween(tx: Pick<Db, "select" | "delete">, a: string, b: string): Promise<void> {
  const mine = await duoOf(tx, a);
  if (mine?.partnerId === b) await tx.delete(duos).where(eq(duos.id, mine.duoId));
}

/** GET /api/duo as `viewerId` sees it. Handles come from projectUser only; no scores, no ids. */
export async function duoView(db: Reader, viewerId: string, now: Date): Promise<DuoResponse> {
  const mine = await duoOf(db, viewerId);
  const open = await db
    .select()
    .from(duoInvites)
    .where(and(eq(duoInvites.status, "pending"), or(eq(duoInvites.fromId, viewerId), eq(duoInvites.toId, viewerId))))
    .orderBy(desc(duoInvites.createdAt), desc(duoInvites.id));
  const otherOf = (i: { fromId: string; toId: string }) => (i.fromId === viewerId ? i.toId : i.fromId);
  const ids = [...new Set([...open.map(otherOf), ...(mine ? [mine.partnerId] : [])])];
  const subjects = await loadProjectionSubjects(db, ids, now);

  let partner: DuoResponse["partner"] = null;
  let checkins: DuoCheckinItem[] = [];
  if (mine) {
    const subject = subjects.get(mine.partnerId);
    partner = subject ? projectUser(subject, "duo") : null;
    const rows = await db
      .select()
      .from(duoCheckins)
      .where(and(eq(duoCheckins.duoId, mine.duoId), gt(duoCheckins.createdAt, new Date(now.getTime() - DUO_CHECKIN_DAYS * DAY_MS))))
      .orderBy(desc(duoCheckins.createdAt), desc(duoCheckins.id))
      .limit(CHECKINS_LISTED);
    checkins = rows.map((r) => ({ id: r.id, kind: r.kind as DuoCheckinItem["kind"], fromMe: r.userId === viewerId, createdAt: r.createdAt.toISOString() }));
  }

  // One query for every block touching the viewer among the invite counterparts.
  const blockRows = ids.length === 0 ? [] : await db.select().from(blocks).where(or(and(eq(blocks.blockerId, viewerId), inArray(blocks.blockedId, ids)), and(eq(blocks.blockedId, viewerId), inArray(blocks.blockerId, ids))));
  const blocked = new Set(blockRows.map((b) => (b.blockerId === viewerId ? b.blockedId : b.blockerId)));
  const pendingInvites: DuoInviteItem[] = [];
  for (const i of open) {
    const other = otherOf(i);
    const subject = subjects.get(other);
    if (!subject || blocked.has(other)) continue;
    const p = projectUser(subject, "public");
    pendingInvites.push({
      id: i.id,
      direction: i.fromId === viewerId ? "outgoing" : "incoming",
      handle: p.handle,
      isCodename: p.isCodename,
      createdAt: i.createdAt.toISOString(),
    });
  }
  return { partner, checkins, pendingInvites };
}

/** Marks every pending invite that involves either user as cancelled (they are in a duo now). */
export async function cancelOpenInvites(tx: Pick<Db, "update">, userIds: string[]): Promise<void> {
  await tx
    .update(duoInvites)
    .set({ status: "cancelled" })
    .where(and(eq(duoInvites.status, "pending"), or(inArray(duoInvites.fromId, userIds), inArray(duoInvites.toId, userIds))));
}
