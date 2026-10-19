import { z } from "zod";
import { RankSchema, RankedDomainSchema } from "./game";
import { PublicProfileSchema, PublicScoresSchema } from "./social";

/** One of the viewer's three rival slots. `profile` is the rival projection (handle = the assignment codename). */
export const RivalSchema = z.object({
  assignmentId: z.string().uuid(),
  slot: z.number().int().min(1).max(3),
  codename: z.string(),
  /** A server-simulated rival (cold start); the app tags it SIM. Never a real person. */
  isGhost: z.boolean(),
  profile: PublicProfileSchema,
});
export type Rival = z.infer<typeof RivalSchema>;

export const RIVAL_CHALLENGE_OUTCOMES = ["win", "loss", "draw", "void"] as const;
export const RivalChallengeOutcomeSchema = z.enum(RIVAL_CHALLENGE_OUTCOMES);
export type RivalChallengeOutcome = z.infer<typeof RivalChallengeOutcomeSchema>;

/**
 * A 7-day, one-domain gain-vs-gain challenge (no score effect). While open, `userCurrent` / `rivalCurrent` are
 * live; once resolved they are the end values. `assignmentId` is null once the slot has been re-matched.
 */
export const RivalChallengeSchema = z.object({
  id: z.string().uuid(),
  assignmentId: z.string().uuid().nullable(),
  codename: z.string(),
  domain: RankedDomainSchema,
  startDate: z.string(),
  endDate: z.string(),
  userStart: z.number(),
  rivalStart: z.number(),
  userCurrent: z.number(),
  rivalCurrent: z.number(),
  outcome: RivalChallengeOutcomeSchema.nullable(),
  acknowledged: z.boolean(),
});
export type RivalChallenge = z.infer<typeof RivalChallengeSchema>;

export const RivalTauntSchema = z.object({
  id: z.string().uuid(),
  codename: z.string(),
  message: z.string(),
  createdAt: z.string(),
  read: z.boolean(),
});
export type RivalTaunt = z.infer<typeof RivalTauntSchema>;

/** GET /api/rivals */
export const RivalsResponseSchema = z.object({
  rivals: z.array(RivalSchema),
  /** The viewer's own shadow for the leaderboard, or null while dormant. */
  shadow: z.object({ codename: z.string(), rank: RankSchema, scores: PublicScoresSchema }).nullable(),
  /** Open challenges and the most recent resolved ones, newest first. */
  challenges: z.array(RivalChallengeSchema),
  record: z.object({ wins: z.number().int(), losses: z.number().int(), draws: z.number().int() }),
  /** The latest transmissions, newest first. */
  taunts: z.array(RivalTauntSchema),
});
export type RivalsResponse = z.infer<typeof RivalsResponseSchema>;

export const RIVAL_CHALLENGE_DAYS = 7;

/** POST /api/rivals/:assignmentId/challenge */
export const RivalChallengeRequestSchema = z.object({
  domain: RankedDomainSchema,
  clientId: z.string().min(1).max(200).optional(),
});
export type RivalChallengeRequest = z.infer<typeof RivalChallengeRequestSchema>;
