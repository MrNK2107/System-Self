import { Router, type IRouter } from "express";
import type { Db } from "@workspace/db";
import { StateQuerySchema } from "@workspace/contracts";
import { ensureRolledOver } from "../services/rollover";
import { buildGameState } from "../services/state";

export function stateRoutes(db: Db): IRouter {
  const router = Router();

  router.get("/state", async (req, res) => {
    const { noticeKinds, uiState } = StateQuerySchema.parse(req.query);
    const now = new Date();
    await ensureRolledOver(db, req.user!.id, now);
    const state = await buildGameState(db, req.user!.id, now, { noticeKinds });
    if (!state) {
      res.status(404).json({ error: "Not onboarded", code: "not_onboarded" });
      return;
    }
    // Debug override for manual palette checks: admins only. Anyone else sending it gets the normal state.
    if (uiState && req.user!.role === "admin") state.uiState = uiState;
    res.json(state);
  });

  return router;
}
