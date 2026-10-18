import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { notices, type Db } from "@workspace/db";
import { NoticesSeenRequestSchema } from "@workspace/contracts";
import { withIdempotency } from "../services/idempotency";
import { unseenNotices } from "../services/state";

export function noticesRoutes(db: Db): IRouter {
  const router = Router();

  router.get("/notices", async (req, res) => {
    const { items, hasMore } = await unseenNotices(db, req.user!.id);
    res.json({ items, hasMore });
  });

  router.post("/notices/seen", async (req, res) => {
    const body = NoticesSeenRequestSchema.parse(req.body);
    const userId = req.user!.id;
    await withIdempotency(db, req, res, "POST /notices/seen", async (tx) => {
      if (body.ids.length > 0) {
        await tx
          .update(notices)
          .set({ seenAt: new Date() })
          .where(and(eq(notices.userId, userId), isNull(notices.seenAt), inArray(notices.id, body.ids)));
      }
      return { status: 204, body: undefined };
    });
  });

  return router;
}
