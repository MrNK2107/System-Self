import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { notices, rivalChallenges, type Db } from "@workspace/db";
import { NoticeListQuerySchema, NoticesSeenRequestSchema } from "@workspace/contracts";
import { withIdempotency } from "../services/idempotency";
import { unseenNotices } from "../services/state";

export function noticesRoutes(db: Db): IRouter {
  const router = Router();

  router.get("/notices", async (req, res) => {
    const { kinds } = NoticeListQuerySchema.parse(req.query);
    const { items, hasMore } = await unseenNotices(db, req.user!.id, kinds);
    res.json({ items, hasMore });
  });

  router.post("/notices/seen", async (req, res) => {
    const body = NoticesSeenRequestSchema.parse(req.body);
    const userId = req.user!.id;
    await withIdempotency(db, req, res, "POST /notices/seen", async (tx) => {
      if (body.ids.length > 0) {
        const now = new Date();
        const marked = await tx
          .update(notices)
          .set({ seenAt: now })
          .where(and(eq(notices.userId, userId), isNull(notices.seenAt), inArray(notices.id, body.ids)))
          .returning({ kind: notices.kind, payload: notices.payload });
        // Seeing a rival challenge result acknowledges that challenge.
        const challengeIds = marked
          .filter((n) => n.kind === "rival_challenge_result")
          .map((n) => (n.payload as { challengeId?: unknown }).challengeId)
          .filter((id): id is string => typeof id === "string");
        if (challengeIds.length > 0) {
          await tx
            .update(rivalChallenges)
            .set({ acknowledgedAt: now })
            .where(
              and(eq(rivalChallenges.userId, userId), inArray(rivalChallenges.id, challengeIds), isNull(rivalChallenges.acknowledgedAt)),
            );
        }
      }
      return { status: 204, body: undefined };
    });
  });

  return router;
}
