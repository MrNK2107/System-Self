import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { localDate, localTimeToInstant } from "@workspace/engine";
import { notificationLog, notificationPrefs, profiles, pushTokens, users, type Db } from "@workspace/db";
import { withUserLock, type Tx } from "../services/user-lock";
import { RESERVED_LOG_KIND } from "../jobs/notifications";
import { NotificationPrefsUpdateSchema, PushTokenRegisterRequestSchema, PushTokenSchema } from "@workspace/contracts";

const DEFAULT_PREFS = { morning: true, nightly: true, events: true };

/** Push tokens and notification prefs (authenticated; mounted behind requireAuth). */
export function pushRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  // Idempotent: a token already on file moves to the signed-in user and its lastSeenAt is refreshed.
  router.post("/push/tokens", async (req, res) => {
    const { token, platform } = PushTokenRegisterRequestSchema.parse(req.body);
    const now = new Date();
    await db
      .insert(pushTokens)
      .values({ userId: req.user!.id, token, platform, createdAt: now, lastSeenAt: now })
      .onConflictDoUpdate({ target: pushTokens.token, set: { userId: req.user!.id, platform, lastSeenAt: now } });
    res.status(204).end();
  });

  // Only the caller's own token is removed; anything else (or a repeat) is a quiet 204.
  router.delete("/push/tokens/:token", async (req, res) => {
    const parsed = PushTokenSchema.safeParse(req.params.token);
    if (parsed.success) await db.delete(pushTokens).where(and(eq(pushTokens.userId, req.user!.id), eq(pushTokens.token, parsed.data)));
    res.status(204).end();
  });

  const prefsOf = async (userId: string, q: Pick<Db, "select"> = db) => {
    const [row] = await q.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)).limit(1);
    return row ? { morning: row.morning, nightly: row.nightly, events: row.events } : DEFAULT_PREFS;
  };

  router.get("/notifications/prefs", async (req, res) => {
    res.json(await prefsOf(req.user!.id));
  });

  router.put("/notifications/prefs", async (req, res) => {
    const update = NotificationPrefsUpdateSchema.parse(req.body);
    const userId = req.user!.id;
    // One transaction under the user lock, so the prefs change and the reservation cannot interleave with a dispatch.
    await withUserLock(db, userId, async (tx) => {
      const before = await prefsOf(userId, tx);
      const insert = tx.insert(notificationPrefs).values({ userId, ...update });
      if (Object.keys(update).length === 0) await insert.onConflictDoNothing();
      else await insert.onConflictDoUpdate({ target: notificationPrefs.userId, set: update });
      await reserveFiredReminders(tx, userId, before, update);
    });
    res.json(await prefsOf(userId));
  });

  /**
   * A reminder switched off after its local time today already fired on the device, so its slot stays spent: write a
   * reserved log row (once) so the cap of 3 holds when the event slots grow.
   */
  async function reserveFiredReminders(tx: Tx, userId: string, before: typeof DEFAULT_PREFS, update: Partial<typeof DEFAULT_PREFS>) {
    const turnedOff = (["morning", "nightly"] as const).filter((k) => update[k] === false && before[k]);
    if (turnedOff.length === 0) return;
    const now = clock();
    const [row] = await tx
      .select({ tz: users.timezone, morning: profiles.morningTime, nightly: profiles.nightlyTime })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) return;
    const date = localDate(now, row.tz);
    for (const k of turnedOff) {
      const [h, m] = row[k].split(":").map(Number);
      if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) continue;
      if (localTimeToInstant(date, h, m, row.tz).getTime() > now.getTime()) continue;
      const kind = RESERVED_LOG_KIND[k];
      const [existing] = await tx
        .select({ id: notificationLog.id })
        .from(notificationLog)
        .where(and(eq(notificationLog.userId, userId), eq(notificationLog.localDate, date), eq(notificationLog.kind, kind)))
        .limit(1);
      if (!existing) await tx.insert(notificationLog).values({ userId, localDate: date, kind, sentAt: now });
    }
  }

  return router;
}
