import { z } from "zod";
import { NoticeSchema, QuestSchema, ScoreResultSchema } from "./game";

const ClientIdSchema = z.string().min(1).max(200);

export const PlaceKindSchema = z.enum(["gym", "sports", "study"]);

/** A place that counts for proof (engine KnownPlace). */
export const KnownPlaceSchema = z.object({
  id: z.string(),
  kind: PlaceKindSchema,
  lat: z.number(),
  lng: z.number(),
  radiusM: z.number(),
  source: z.enum(["saved", "osm", "learned"]),
  name: z.string().nullable().optional(),
});
export type KnownPlaceDto = z.infer<typeof KnownPlaceSchema>;

/** GET /api/places/nearby?lat&lng: the user's saved places plus OpenStreetMap and learned places within ~3 km. */
export const PlacesNearbyResponseSchema = z.object({ places: z.array(KnownPlaceSchema) });

/** POST /api/places: save "my gym" / "my ground" / "my library" at the phone's current position. */
export const SavePlaceRequestSchema = z.object({
  kind: PlaceKindSchema,
  name: z.string().trim().min(1).max(60),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().min(30).max(300).default(100),
});
export const SavePlaceResponseSchema = z.object({ place: KnownPlaceSchema });

/** What the phone sends after a live session (engine SessionSummary). Raw traces never leave the phone. */
export const SessionSummarySchema = z.object({
  kind: z.enum(["workout", "study"]),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  activeMinutes: z.number().int().min(0).max(1440),
  steps: z.number().int().min(0).max(200000),
  placeId: z.string().nullable(),
  placeShare: z.number().min(0).max(1),
  mocked: z.boolean(),
  /** Session centre rounded to ~100 m (engine coarse), for learning places. Absent without location permission. */
  coarse: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
});
export type SessionSummaryDto = z.infer<typeof SessionSummarySchema>;

/** POST /api/quests/:id/session: submit a live session as proof for a quest. */
export const SessionProofRequestSchema = z.object({ clientId: ClientIdSchema.optional(), summary: SessionSummarySchema });

export const ProofStatusSchema = z.enum(["accepted", "rejected", "awaiting_review"]);
export const ProofSchema = z.object({
  id: z.string(),
  questId: z.string(),
  method: z.enum(["session", "quiz", "vouch", "health", "money"]),
  status: ProofStatusSchema,
  reason: z.string(),
  evidence: z.array(z.string()),
  createdAt: z.string(),
});
export type ProofDto = z.infer<typeof ProofSchema>;

/**
 * The verdict. When accepted and it was the last proof the quest needed, the quest is completed in the same call
 * (`completed` true, `results` and `notices` as POST /quests/:id/complete). For weekly/arc quests `progress` counts
 * accepted sessions so far against the sessions needed.
 */
export const SessionProofResponseSchema = z.object({
  proof: ProofSchema,
  quest: QuestSchema,
  completed: z.boolean(),
  progress: z.object({ done: z.number().int(), needed: z.number().int() }).nullable(),
  results: z.array(ScoreResultSchema),
  notices: z.array(NoticeSchema),
});
