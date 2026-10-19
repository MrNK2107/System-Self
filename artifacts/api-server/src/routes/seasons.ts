import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { profiles, seasons, users, type Db } from "@workspace/db";
import { SeasonRequestSchema, type SeasonsResponse } from "@workspace/contracts";
import { lifeContext, localDate, validateSeason, type LifeContextKey } from "@workspace/engine";
import { withIdempotency } from "../services/idempotency";
import { currentSeasons, toSeason } from "../services/seasons";
import { withUserLock, type Tx } from "../services/user-lock";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The user's timezone and life context, or null before onboarding. */
async function seasonBasis(tx: Pick<Db, "select">, userId: string) {
  const [row] = await tx
    .select({ tz: users.timezone, life: profiles.lifeContext })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.userId, userId));
  return row ? { tz: row.tz, life: row.life as LifeContextKey } : null;
}

export function seasonsRoutes(db: Db, clock: () => Date = () => new Date()): IRouter {
  const router = Router();

  router.get("/seasons", async (req, res) => {
    const userId = req.user!.id;
    const out = await withUserLock(db, userId, async (tx: Tx) => {
      const basis = await seasonBasis(tx, userId);
      if (!basis) return null;
      const cur = await currentSeasons(tx, userId, localDate(clock(), basis.tz));
      const body: SeasonsResponse = { ...cur, availableKinds: lifeContext(basis.life).seasons };
      return body;
    });
    if (!out) {
      res.status(409).json({ error: "Onboarding required", code: "not_onboarded" });
      return;
    }
    res.json(out);
  });

  /** Schedules a season ahead of time (start from tomorrow). Quest content shrinks; scoring never changes. */
  router.post("/seasons", async (req, res) => {
    const body = SeasonRequestSchema.parse(req.body);
    const userId = req.user!.id;
    await withIdempotency(db, req, res, "POST /seasons", async (tx) => {
      const basis = await seasonBasis(tx, userId);
      if (!basis) return { status: 409, body: { error: "Onboarding required", code: "not_onboarded" } };
      const today = localDate(clock(), basis.tz);
      const existing = await tx.select({ startsOn: seasons.startsOn, endsOn: seasons.endsOn }).from(seasons).where(eq(seasons.userId, userId));
      const result = validateSeason(body, { today, lifeContext: basis.life, existing });
      if (!result.ok) {
        const status = result.code === "season_conflict" ? 409 : 400;
        return { status, body: { error: "Season not allowed", code: result.code } };
      }
      const [row] = await tx
        .insert(seasons)
        .values({ userId, kind: body.kind, startsOn: body.startsOn, endsOn: result.endsOn })
        .returning();
      return { status: 201, body: toSeason(row!) };
    });
  });

  /** Cancels a scheduled season. One that has started stays. */
  router.delete("/seasons/:id", async (req, res) => {
    const id = String(req.params.id);
    const userId = req.user!.id;
    if (!UUID.test(id)) {
      res.status(404).json({ error: "Season not found" });
      return;
    }
    await withIdempotency(db, req, res, `DELETE /seasons/${id}`, async (tx) => {
      const basis = await seasonBasis(tx, userId);
      if (!basis) return { status: 409, body: { error: "Onboarding required", code: "not_onboarded" } };
      const [row] = await tx.select().from(seasons).where(and(eq(seasons.id, id), eq(seasons.userId, userId)));
      if (!row) return { status: 404, body: { error: "Season not found" } };
      if (row.startsOn <= localDate(clock(), basis.tz)) {
        return { status: 409, body: { error: "Season already started", code: "season_started" } };
      }
      await tx.delete(seasons).where(eq(seasons.id, id));
      return { status: 204, body: null };
    });
  });

  return router;
}
