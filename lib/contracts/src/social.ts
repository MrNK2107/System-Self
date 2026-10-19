import { z } from "zod";
import { RANKED_DOMAIN_VALUES, RankSchema, TrajectorySchema } from "./game";

/** A handle as typed or linked by a client: a username (public users only) or a public codename. */
export const SocialHandleSchema = z.string().trim().min(1).max(64);

/** Ranked-domain scores a viewer is allowed to see (never the hidden score). */
export const PublicScoresSchema = z.object(
  Object.fromEntries(RANKED_DOMAIN_VALUES.map((d) => [d, z.number()])) as Record<(typeof RANKED_DOMAIN_VALUES)[number], z.ZodNumber>,
);

/**
 * The only shape in which another player is shown. Built by projectUser, which alone decides which fields a
 * viewer's relation allows: no user id, no hidden score, no quest or log content.
 */
export const PublicProfileSchema = z.object({
  handle: z.string(),
  isCodename: z.boolean(),
  rank: RankSchema,
  trajectory: TrajectorySchema,
  shadowActive: z.boolean(),
  scores: PublicScoresSchema.optional(),
  clanTag: z.string().optional(),
});
export type PublicProfile = z.infer<typeof PublicProfileSchema>;

export const PublicProfileListSchema = z.array(PublicProfileSchema);

export const SOCIAL_SEARCH_MIN_CHARS = 3;
export const SocialSearchQuerySchema = z.object({
  q: z.string().trim().min(SOCIAL_SEARCH_MIN_CHARS).max(32),
});

/** GET /api/social/profile/:handle */
export const SocialProfileResponseSchema = z.object({
  profile: PublicProfileSchema,
  /** The viewer follows this player. */
  following: z.boolean(),
});
export type SocialProfileResponse = z.infer<typeof SocialProfileResponseSchema>;

export const FollowersCountResponseSchema = z.object({ count: z.number().int().min(0) });
export type FollowersCountResponse = z.infer<typeof FollowersCountResponseSchema>;

export const REPORT_REASON_MAX = 500;
export const UserReportRequestSchema = z.object({
  subject: SocialHandleSchema,
  reason: z.string().trim().min(1).max(REPORT_REASON_MAX),
  clientId: z.string().min(1).max(200).optional(),
});
export type UserReportRequest = z.infer<typeof UserReportRequestSchema>;

export const UserReportResponseSchema = z.object({ id: z.string().uuid() });
export type UserReportResponse = z.infer<typeof UserReportResponseSchema>;
