import { Router, type IRouter } from "express";
import { and, count, eq } from "drizzle-orm";
import { places, type Db } from "@workspace/db";
import { SavePlaceRequestSchema } from "@workspace/contracts";
import { z } from "zod";
import { ensureOsmTile, nearbyPlaces, toKnownPlace, type FetchLike } from "../services/places";

const LatLngQuery = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });
const IdSchema = z.string().uuid();
/** A user can save this many of their own places (gym, ground, library...). */
export const MAX_SAVED_PLACES = 10;

/** Places that count as proof (spec 8.3): nearby lookup (refreshing OpenStreetMap), and the user's own saved places. */
export function placesRoutes(db: Db, clock: () => Date = () => new Date(), fetchImpl?: FetchLike): IRouter {
  const router = Router();

  router.get("/places/nearby", async (req, res) => {
    const q = LatLngQuery.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: "lat and lng are required", code: "invalid_location" });
      return;
    }
    await ensureOsmTile(db, q.data.lat, q.data.lng, clock(), fetchImpl);
    res.json({ places: await nearbyPlaces(db, req.user!.id, q.data.lat, q.data.lng) });
  });

  router.post("/places", async (req, res) => {
    const body = SavePlaceRequestSchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: "Invalid place", code: "invalid_place" });
      return;
    }
    const userId = req.user!.id;
    const [{ n }] = (await db.select({ n: count() }).from(places).where(eq(places.userId, userId))) as [{ n: number }];
    if (n >= MAX_SAVED_PLACES) {
      res.status(409).json({ error: `You can save up to ${MAX_SAVED_PLACES} places. Remove one first.`, code: "place_limit" });
      return;
    }
    const [row] = await db
      .insert(places)
      .values({ source: "saved", userId, ...body.data, createdAt: clock() })
      .returning();
    res.status(201).json({ place: toKnownPlace(row!) });
  });

  router.delete("/places/:id", async (req, res) => {
    const id = IdSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json({ error: "Place not found", code: "not_found" });
      return;
    }
    const gone = await db
      .delete(places)
      .where(and(eq(places.id, id.data), eq(places.userId, req.user!.id)))
      .returning({ id: places.id });
    if (gone.length === 0) {
      res.status(404).json({ error: "Place not found", code: "not_found" });
      return;
    }
    res.status(204).end();
  });

  return router;
}
