import { Router, type IRouter } from "express";
import type { Db } from "@workspace/db";
import { ensureRolledOver } from "../services/rollover";
import { buildGameState } from "../services/state";

export function stateRoutes(db: Db): IRouter {
  const router = Router();

  router.get("/state", async (req, res) => {
    const now = new Date();
    await ensureRolledOver(db, req.user!.id, now);
    const state = await buildGameState(db, req.user!.id, now);
    if (!state) {
      res.status(404).json({ error: "Not onboarded", code: "not_onboarded" });
      return;
    }
    res.json(state);
  });

  return router;
}
