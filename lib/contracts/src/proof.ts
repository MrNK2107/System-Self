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
  /** What was studied (study sessions only): the quiz is on this topic. */
  topic: z.string().trim().min(2).max(120).optional(),
});
export type SessionSummaryDto = z.infer<typeof SessionSummarySchema>;

/** POST /api/quests/:id/session: submit a live session as proof for a quest. */
export const SessionProofRequestSchema = z.object({ clientId: ClientIdSchema.optional(), summary: SessionSummarySchema });

/** awaiting_quiz: a study session waiting for its quiz answers. awaiting_review: an answer the AI will grade later. */
export const ProofStatusSchema = z.enum(["accepted", "rejected", "awaiting_quiz", "awaiting_review"]);
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
export const QuizQuestionSchema = z.object({
  id: z.string(),
  kind: z.enum(["mcq", "short"]),
  prompt: z.string(),
  options: z.array(z.string()).optional(),
});
/** A study session's quiz (never the answers). Answer it with POST /api/proofs/:proofId/quiz before `expiresAt`. */
export const QuizSchema = z.object({
  proofId: z.string(),
  source: z.enum(["ai", "bank", "explain"]),
  questions: z.array(QuizQuestionSchema),
  expiresAt: z.string(),
});
export type QuizDto = z.infer<typeof QuizSchema>;

export const SessionProofResponseSchema = z.object({
  proof: ProofSchema,
  quest: QuestSchema,
  completed: z.boolean(),
  progress: z.object({ done: z.number().int(), needed: z.number().int() }).nullable(),
  results: z.array(ScoreResultSchema),
  notices: z.array(NoticeSchema),
  /** Study sessions that lasted long enough: the quiz to answer next (proof status awaiting_quiz). */
  quiz: QuizSchema.nullable().optional(),
});

/** POST /api/proofs/:id/quiz: one answer per question, in order (an option index for MCQ, text for short). */
export const QuizAnswerRequestSchema = z.object({
  clientId: ClientIdSchema.optional(),
  answers: z.array(z.union([z.number().int().min(0).max(9), z.string().max(2000)])).min(1).max(10),
});

/** POST /api/quests/:id/vouch: ask a clan member, duo partner or mutual follow (by handle) to vouch for this quest. */
export const VouchCreateRequestSchema = z.object({
  handle: z.string().trim().min(1).max(40),
  note: z.string().trim().min(1).max(140),
});
export const VouchCreateResponseSchema = z.object({
  request: z.object({ id: z.string(), status: z.literal("pending"), createdAt: z.string(), expiresAt: z.string() }),
});

/** GET /api/vouches/incoming: requests waiting for me. `from` is the requester's public codename. */
export const IncomingVouchSchema = z.object({
  id: z.string(),
  from: z.string(),
  questTitle: z.string(),
  note: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type IncomingVouch = z.infer<typeof IncomingVouchSchema>;
export const IncomingVouchListSchema = z.object({ items: z.array(IncomingVouchSchema) });

/** POST /api/vouches/:id/respond. Confirming needs your own quest proven today (spec 8.6). */
export const VouchRespondRequestSchema = z.object({ confirm: z.boolean() });
export const VouchRespondResponseSchema = z.object({ status: z.enum(["confirmed", "denied"]), completed: z.boolean() });
