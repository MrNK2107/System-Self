import { Router, type IRouter } from "express";
import { and, eq, gt, notInArray } from "drizzle-orm";
import { profiles, seasons, users, type Db } from "@workspace/db";
import { lifeContext, localDate } from "@workspace/engine";
import { HomePathRequestSchema, ProfileUpdateSchema } from "@workspace/contracts";
import { withIdempotency } from "../services/idempotency";
import { buildGameState } from "../services/state";

export function profileRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
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
      const now = clock();
      if (patch.lifeContext !== undefined) {
        // Scheduled (not yet started) seasons of a kind the new context does not offer are cancelled; started ones stay.
        const [u] = await tx.select({ tz: users.timezone }).from(users).where(eq(users.id, userId));
        await tx
          .delete(seasons)
          .where(
            and(
              eq(seasons.userId, userId),
              gt(seasons.startsOn, localDate(now, u!.tz)),
              notInArray(seasons.kind, [...lifeContext(patch.lifeContext).seasons]),
            ),
          );
      }
      const state = await buildGameState(tx, userId, now);
      return { status: 200, body: state!.profile };
    });
  });

  /** Opts in to or out of the home path. Turning it on starts a fresh count of home sessions. */
  router.post("/profile/home-path", async (req, res) => {
    const body = HomePathRequestSchema.parse(req.body ?? {});
    const userId = req.user!.id;
    await withIdempotency(db, req, res, "POST /profile/home-path", async (tx) => {
      const [current] = await tx.select({ active: profiles.homePathActive }).from(profiles).where(eq(profiles.userId, userId));
      if (!current) return { status: 409, body: { error: "Onboarding required", code: "not_onboarded" } };
      await tx
        .update(profiles)
        .set({ homePathActive: body.active, ...(body.active && !current.active ? { homeSessions: 0 } : {}) })
        .where(eq(profiles.userId, userId));
      const state = await buildGameState(tx, userId, clock());
      return { status: 200, body: state!.profile };
    }, { preferClientId: true });
  });

  return router;
}
