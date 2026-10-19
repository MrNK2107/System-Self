import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { notificationPrefs, pushTokens, type Db } from "@workspace/db";
import { NotificationPrefsUpdateSchema, PushTokenRegisterRequestSchema, PushTokenSchema } from "@workspace/contracts";

const DEFAULT_PREFS = { morning: true, nightly: true, events: true };

/** Push tokens and notification prefs (authenticated; mounted behind requireAuth). */
export function pushRoutes(db: Db): IRouter {
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

  const prefsOf = async (userId: string) => {
    const [row] = await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)).limit(1);
    return row ? { morning: row.morning, nightly: row.nightly, events: row.events } : DEFAULT_PREFS;
  };

  router.get("/notifications/prefs", async (req, res) => {
    res.json(await prefsOf(req.user!.id));
  });

  router.put("/notifications/prefs", async (req, res) => {
    const update = NotificationPrefsUpdateSchema.parse(req.body);
    const userId = req.user!.id;
    const insert = db.insert(notificationPrefs).values({ userId, ...update });
    if (Object.keys(update).length === 0) await insert.onConflictDoNothing();
    else await insert.onConflictDoUpdate({ target: notificationPrefs.userId, set: update });
    res.json(await prefsOf(userId));
  });

  return router;
}
