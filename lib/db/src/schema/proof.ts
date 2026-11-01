import { sql } from "drizzle-orm";
import { doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { quests } from "./game";
import { users } from "./users";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Places that count for proof (spec 8.3): a user's own saved place (user_id set, private to them), an OpenStreetMap
 * place (osm_id set, shared), or a place learned from at least 3 users' sessions (shared).
 */
export const places = pgTable(
  "places",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(), // saved | osm | learned
    kind: text("kind").notNull(), // gym | sports | study
    name: text("name"),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    radiusM: integer("radius_m").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    osmId: text("osm_id"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("places_lat_lng_idx").on(t.lat, t.lng),
    index("places_user_idx").on(t.userId).where(sql`${t.userId} is not null`),
    uniqueIndex("places_osm_id_idx").on(t.osmId).where(sql`${t.osmId} is not null`),
  ],
);

/** OpenStreetMap tiles already fetched from Overpass, so each ~5 km tile is queried at most once a month. */
export const placeTiles = pgTable("place_tiles", {
  tileKey: text("tile_key").primaryKey(),
  fetchedAt: ts("fetched_at").notNull(),
});

/** Coarse (~100 m) centres of proven sessions, the only location kept on the server; feeds learned places. */
export const sessionSpots = pgTable(
  "session_spots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // gym | study
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [index("session_spots_lat_lng_idx").on(t.lat, t.lng), index("session_spots_created_idx").on(t.createdAt)],
);

/**
 * Evidence for a quest (spec 8.1). `summary` holds the session summary or quiz/vouch details, never raw traces.
 * A quest can have several proofs (a rejected try, then an accepted one; weekly quests collect one per session).
 */
export const questProofs = pgTable(
  "quest_proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questId: uuid("quest_id")
      .notNull()
      .references(() => quests.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    method: text("method").notNull(), // session | quiz | vouch | health | money
    status: text("status").notNull(), // accepted | rejected | awaiting_review
    summary: jsonb("summary").notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    clientId: text("client_id"),
    createdAt: ts("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("quest_proofs_quest_idx").on(t.questId),
    index("quest_proofs_user_created_idx").on(t.userId, t.createdAt),
    uniqueIndex("quest_proofs_user_client_idx").on(t.userId, t.clientId).where(sql`${t.clientId} is not null`),
  ],
);
