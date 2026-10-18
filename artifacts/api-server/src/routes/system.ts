import { DB_UNAVAILABLE } from "../lib/db-unavailable";
import { Router, type IRouter } from "express";
import { questCompletionEvents, type Db } from "@workspace/db";
import { validateBody } from "../middlewares/validate";
import { questCompletionEventBodySchema } from "../lib/schemas";

export function systemRoutes(db: Db | null): IRouter {
const router = Router();

router.post("/system/quest-completion", validateBody(questCompletionEventBodySchema), async (req, res) => {
  try {
    if (!db) return res.status(503).json(DB_UNAVAILABLE);
    const headerKey = typeof req.headers["idempotency-key"] === "string"
      ? req.headers["idempotency-key"].trim()
      : undefined;
    const idempotencyKey =
      req.body.idempotencyKey ||
      headerKey ||
      `${req.body.questId}:${req.body.status}:${req.body.domain}:${req.body.questType}`;

    const inserted = await db
      .insert(questCompletionEvents)
      .values({
        userId: req.user!.id,
        questId: req.body.questId,
        status: req.body.status,
        domain: req.body.domain,
        questType: req.body.questType,
        idempotencyKey,
        completedAt: req.body.completedAt ? new Date(req.body.completedAt) : new Date(),
        source: req.body.source,
      })
      .onConflictDoNothing({ target: [questCompletionEvents.userId, questCompletionEvents.idempotencyKey] })
      .returning({ id: questCompletionEvents.id });
    if (inserted.length === 0) {
      return res.status(200).json({ status: "ok", deduplicated: true });
    }
    return res.status(201).json({ status: "ok" });
  } catch (error) {
    req.log.error({ error }, "Failed to persist quest completion event");
    return res.status(500).json({ error: "Failed to persist completion event" });
  }
});

return router;
}
