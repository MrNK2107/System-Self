import { z } from "zod";
import { QuestSchema, RankedDomainSchema } from "./game";
import { SocialHandleSchema } from "./social";

/** Named challenge rules (PRD 14), shared by the server and the app copy. */
export const NAMED_CHALLENGE_DAYS = [3, 7, 14, 30] as const;
/** Winner / loser DISCIPLINE delta through applyChanges (reason `challenge`); a draw changes nothing. */
export const CHALLENGE_WIN_DELTA = 3.0;
export const CHALLENGE_LOSS_DELTA = -1.5;
/** A pending challenge not answered within this many hours is ignored automatically. */
export const CHALLENGE_RESPOND_HOURS = 48;
/** At most this many open (pending + active) challenges per user, counting both roles. */
export const CHALLENGE_MAX_OPEN = 3;
/** What the challenger reads once a challenge is ignored (by the opponent or by the 48 h timeout). */
export const CHALLENGE_IGNORED_LINE = "Challenge ignored. Logged.";

export const NamedChallengeDaysSchema = z.union([z.literal(3), z.literal(7), z.literal(14), z.literal(30)]);
export const NamedChallengeStatusSchema = z.enum(["pending", "active", "ignored", "resolved", "void"]);
export type NamedChallengeStatus = z.infer<typeof NamedChallengeStatusSchema>;
export const NamedChallengeOutcomeSchema = z.enum(["win", "loss", "draw"]);
export type NamedChallengeOutcome = z.infer<typeof NamedChallengeOutcomeSchema>;

const clientId = z.string().min(1).max(200).optional();

/** POST /api/challenges (PRO). `opponent` is a handle the challenger can see: a followed user, or a clanmate's username. */
export const ChallengeCreateRequestSchema = z.object({
  opponent: SocialHandleSchema,
  domain: RankedDomainSchema,
  days: NamedChallengeDaysSchema,
  clientId,
});
export type ChallengeCreateRequest = z.infer<typeof ChallengeCreateRequestSchema>;

/** POST /api/challenges/:id/accept | ignore */
export const ChallengeRespondRequestSchema = z.object({ clientId });

/**
 * One challenge as one of its two participants sees it. The other party is a handle only (projectUser rules: a
 * username inside a clan or for a public player, else the public codename; null once the account is gone). The
 * only numbers are the two domain-score gains in the challenged domain, the stake both sides agreed to; no
 * other score, no hidden score. `myGain` / `theirGain` are live while active and final once resolved.
 */
export const ChallengeSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["challenger", "opponent"]),
  opponent: z.object({ handle: z.string().nullable(), isCodename: z.boolean() }),
  domain: RankedDomainSchema,
  days: NamedChallengeDaysSchema,
  status: NamedChallengeStatusSchema,
  createdAt: z.string(),
  respondBy: z.string(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  myGain: z.number().nullable(),
  theirGain: z.number().nullable(),
  outcome: NamedChallengeOutcomeSchema.nullable(),
  /** "Challenge ignored. Logged." for the challenger of an ignored challenge, else null. */
  line: z.string().nullable(),
});
export type Challenge = z.infer<typeof ChallengeSchema>;

/** GET /api/challenges: the viewer's open challenges and the most recent closed ones, newest first. */
export const ChallengeListResponseSchema = z.object({ items: z.array(ChallengeSchema) });
export type ChallengeListResponse = z.infer<typeof ChallengeListResponseSchema>;

/** PATCH /api/quests/:id/shame (PRO, in a clan, own active quest). */
export const QuestShameRequestSchema = z.object({ enabled: z.boolean(), clientId });
export type QuestShameRequest = z.infer<typeof QuestShameRequestSchema>;
export const QuestShameResponseSchema = z.object({ quest: QuestSchema });
