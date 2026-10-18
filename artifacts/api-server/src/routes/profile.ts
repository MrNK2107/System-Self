import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { profiles, type Db } from "@workspace/db";
import { ProfileUpdateSchema } from "@workspace/contracts";
import { withIdempotency } from "../services/idempotency";
import { buildGameState } from "../services/state";

export function profileRoutes(db: Db): IRouter {
  const router = Router();

  router.patch("/profile", async (req, res) => {
    const patch = ProfileUpdateSchema.parse(req.body);
    const userId = req.user!.id;

    await withIdempotency(db, req, res, "PATCH /profile", async (tx) => {
      const updated = await tx
        .update(profiles)
        .set(patch)
        .where(eq(profiles.userId, userId))
        .returning({ userId: profiles.userId });
      if (updated.length === 0) return { status: 409, body: { error: "Onboarding required", code: "not_onboarded" } };
      const state = await buildGameState(tx, userId, new Date());
      return { status: 200, body: state!.profile };
    });
  });

  return router;
}
