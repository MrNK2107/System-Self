import { and, between, eq, gte, isNull, or } from "drizzle-orm";
import { places, placeTiles, sessionSpots, type Db } from "@workspace/db";
import { distanceM, learnPlaces, LEARNED_PLACE_RADIUS_M, type KnownPlace, type PlaceKind } from "@workspace/engine";
import { logger } from "../lib/logger";
import type { Tx } from "./user-lock";

/** OpenStreetMap is fetched in tiles of this many degrees (~5.5 km), padded so places near an edge are included. */
const TILE_DEG = 0.05;
const TILE_PAD_DEG = 0.02;
const TILE_MAX_AGE_MS = 30 * 86_400_000;
/** "Nearby" for the phone: a box of about ±3 km. */
const NEARBY_DEG = 0.03;
/** Overpass endpoint; "off" disables OpenStreetMap lookups (tests, offline servers). Read per call. */
const overpassUrl = () => process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

export type FetchLike = (url: string, init: { method: string; body: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export const tileKey = (lat: number, lng: number) => `${Math.floor(lat / TILE_DEG)}:${Math.floor(lng / TILE_DEG)}`;

/** OSM tags → our place kind and radius. Gyms are small, grounds and campuses large. */
export function osmKind(tags: Record<string, string>): { kind: PlaceKind; radiusM: number } | null {
  const leisure = tags.leisure;
  const amenity = tags.amenity;
  if (leisure === "fitness_centre" || amenity === "gym") return { kind: "gym", radiusM: 80 };
  if (leisure && ["sports_centre", "stadium", "pitch", "swimming_pool", "track", "sports_hall"].includes(leisure)) {
    return { kind: "sports", radiusM: 120 };
  }
  if (amenity === "library") return { kind: "study", radiusM: 60 };
  if (amenity === "college" || amenity === "university") return { kind: "study", radiusM: 150 };
  return null;
}

/** Parses an Overpass `out center tags` response into places. Elements without a usable position or kind are skipped. */
export function parseOverpass(body: unknown): { osmId: string; kind: PlaceKind; radiusM: number; lat: number; lng: number; name: string | null }[] {
  const els = (body as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(els)) return [];
  const out = [];
  for (const raw of els) {
    const e = raw as { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    const k = osmKind(e.tags ?? {});
    if (typeof lat !== "number" || typeof lng !== "number" || !k || !e.type || e.id === undefined) continue;
    out.push({ osmId: `${e.type}/${e.id}`, ...k, lat, lng, name: e.tags?.name ?? null });
  }
  return out;
}

function overpassQuery(s: number, w: number, n: number, e: number): string {
  const box = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:15];(nwr["leisure"~"^(fitness_centre|sports_centre|stadium|pitch|swimming_pool|track|sports_hall)$"]${box};nwr["amenity"~"^(gym|library|college|university)$"]${box};);out center tags 300;`;
}

/**
 * Makes sure the OSM tile around (lat, lng) is cached: fetched from Overpass if never fetched or older than a month.
 * Best effort: a failed or slow Overpass call leaves whatever is cached and is retried on a later request.
 */
export async function ensureOsmTile(db: Db, lat: number, lng: number, now: Date, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<void> {
  const url = overpassUrl();
  if (url === "off") return;
  const key = tileKey(lat, lng);
  const [tile] = await db.select().from(placeTiles).where(eq(placeTiles.tileKey, key)).limit(1);
  if (tile && now.getTime() - tile.fetchedAt.getTime() < TILE_MAX_AGE_MS) return;
  const s = Math.floor(lat / TILE_DEG) * TILE_DEG - TILE_PAD_DEG;
  const w = Math.floor(lng / TILE_DEG) * TILE_DEG - TILE_PAD_DEG;
  const n = s + TILE_DEG + 2 * TILE_PAD_DEG;
  const e = w + TILE_DEG + 2 * TILE_PAD_DEG;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      body: `data=${encodeURIComponent(overpassQuery(s, w, n, e))}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "SystemSelf/1.0 (proof places)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const found = parseOverpass(await res.json());
    if (found.length > 0) {
      await db
        .insert(places)
        .values(found.map((p) => ({ source: "osm", kind: p.kind, name: p.name, lat: p.lat, lng: p.lng, radiusM: p.radiusM, osmId: p.osmId })))
        .onConflictDoNothing();
    }
    await db
      .insert(placeTiles)
      .values({ tileKey: key, fetchedAt: now })
      .onConflictDoUpdate({ target: placeTiles.tileKey, set: { fetchedAt: now } });
  } catch (e) {
    logger.warn({ err: e, tile: key }, "overpass fetch failed; using cached places");
  }
}

export function toKnownPlace(r: typeof places.$inferSelect): KnownPlace {
  return {
    id: r.id,
    kind: r.kind as PlaceKind,
    lat: r.lat,
    lng: r.lng,
    radiusM: r.radiusM,
    source: r.source as KnownPlace["source"],
    name: r.name,
  };
}

/** The user's own saved places plus shared (OSM and learned) places within about ±3 km. Others' saved places never. */
export async function nearbyPlaces(db: Db | Tx, userId: string, lat: number, lng: number): Promise<KnownPlace[]> {
  const rows = await db
    .select()
    .from(places)
    .where(
      and(
        between(places.lat, lat - NEARBY_DEG, lat + NEARBY_DEG),
        between(places.lng, lng - NEARBY_DEG, lng + NEARBY_DEG),
        or(isNull(places.userId), eq(places.userId, userId)),
      ),
    )
    .limit(500);
  return rows.map(toKnownPlace);
}

/** A place the user may use as proof: their own saved place or a shared one. */
export async function placeForUser(db: Db | Tx, userId: string, placeId: string): Promise<KnownPlace | null> {
  const [r] = await db
    .select()
    .from(places)
    .where(and(eq(places.id, placeId), or(isNull(places.userId), eq(places.userId, userId))))
    .limit(1);
  return r ? toKnownPlace(r) : null;
}

const SPOT_WINDOW_MS = 30 * 86_400_000;
const SPOT_BOX_DEG = 0.003;

/**
 * Records a proven session's coarse spot and turns the spot into a learned place once enough different users train
 * (or study) there (engine learnPlaces). Skips spots already covered by a known place of the same kind.
 */
export async function recordSpotAndLearn(
  tx: Tx,
  userId: string,
  kind: "gym" | "study",
  spot: { lat: number; lng: number },
  now: Date,
): Promise<void> {
  await tx.insert(sessionSpots).values({ userId, kind, lat: spot.lat, lng: spot.lng, createdAt: now });
  const recent = await tx
    .select()
    .from(sessionSpots)
    .where(
      and(
        eq(sessionSpots.kind, kind),
        between(sessionSpots.lat, spot.lat - SPOT_BOX_DEG, spot.lat + SPOT_BOX_DEG),
        between(sessionSpots.lng, spot.lng - SPOT_BOX_DEG, spot.lng + SPOT_BOX_DEG),
        gte(sessionSpots.createdAt, new Date(now.getTime() - SPOT_WINDOW_MS)),
      ),
    );
  const learned = learnPlaces(recent.map((r) => ({ userId: r.userId, kind: r.kind as PlaceKind, lat: r.lat, lng: r.lng })));
  if (learned.length === 0) return;
  const existing = (await nearbyPlaces(tx, userId, spot.lat, spot.lng)).filter((p) => p.source !== "saved");
  for (const l of learned) {
    const covered = existing.some(
      (p) => (p.kind === l.kind || (l.kind === "gym" && p.kind === "sports")) && distanceM(p, l) <= Math.max(p.radiusM, LEARNED_PLACE_RADIUS_M),
    );
    if (!covered) await tx.insert(places).values({ source: "learned", kind: l.kind, lat: l.lat, lng: l.lng, radiusM: l.radiusM, name: null });
  }
}
