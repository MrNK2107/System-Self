import { Router, type IRouter } from "express";
import type { Db } from "@workspace/db";
import { evaluateComeback } from "../services/comeback";
import { withUserLock } from "../services/user-lock";

export function comebackRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  /**
   * The checklist of today's comeback (null when none), evaluated from today's logs and quests. Completing it
   * stamps the comeback, adds a returner mark and a notice, once. It never changes a score.
   */
  router.get("/comeback", async (req, res) => {
    const userId = req.user!.id;
    const body = await withUserLock(db, userId, (tx) => evaluateComeback(tx, userId, clock()));
    res.json(body);
  });

  return router;
}
