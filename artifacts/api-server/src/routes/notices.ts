import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { notices, type Db } from "@workspace/db";
import { NoticesSeenRequestSchema } from "@workspace/contracts";
import { withIdempotency } from "../services/idempotency";

export function noticesRoutes(db: Db): IRouter {
  const router = Router();

  router.get("/notices", async (req, res) => {
    const rows = await db
      .select()
      .from(notices)
      .where(and(eq(notices.userId, req.user!.id), isNull(notices.seenAt)))
      .orderBy(asc(notices.createdAt), asc(notices.id));
    res.json({
      items: rows.map((n) => ({ id: n.id, kind: n.kind, payload: n.payload, createdAt: n.createdAt.toISOString() })),
    });
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
