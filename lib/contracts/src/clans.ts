import { z } from "zod";
import { PublicProfileSchema } from "./social";

/** Hard size limits (PRD 15): below the minimum a clan is `forming` (no raids, not ranked). */
export const CLAN_MIN_ACTIVE = 8;
export const CLAN_MAX_MEMBERS = 30;
export const CLAN_NAME_MIN = 3;
export const CLAN_NAME_MAX = 24;
export const CLAN_NAME_RE = /^[A-Za-z0-9 _-]+$/;
export const CLAN_TAG_RE = /^[A-Z]{2,5}$/;
export const CLAN_DESCRIPTION_MAX = 200;
/**
 * The activity window: the CLAN_INACTIVE_DAYS full local days ending yesterday (today excluded). A member with no
 * log in it is inactive (excluded from the clan score); one who was also in the clan for the whole window is dead
 * weight (flagged, removable by the leader).
 */
export const CLAN_INACTIVE_DAYS = 5;
/** Below this many active members a clan has no score and no rank (a mean of 1–2 would reveal hidden scores). */
export const CLAN_SCORE_MIN_ACTIVE = 3;

export const ClanStatusSchema = z.enum(["forming", "active"]);
export type ClanStatus = z.infer<typeof ClanStatusSchema>;
export const ClanRoleSchema = z.enum(["leader", "member"]);
export type ClanRole = z.infer<typeof ClanRoleSchema>;

const clientId = z.string().min(1).max(200).optional();

/** POST /api/clans (PRO + verified email). */
export const ClanCreateRequestSchema = z.object({
  name: z.string().trim().min(CLAN_NAME_MIN).max(CLAN_NAME_MAX).regex(CLAN_NAME_RE),
  tag: z.string().trim().regex(CLAN_TAG_RE),
  description: z.string().trim().max(CLAN_DESCRIPTION_MAX).optional(),
  clientId,
});
export type ClanCreateRequest = z.infer<typeof ClanCreateRequestSchema>;

/** POST /api/clans/join */
export const ClanJoinCodeRequestSchema = z.object({ inviteCode: z.string().trim().min(4).max(16), clientId });
export type ClanJoinCodeRequest = z.infer<typeof ClanJoinCodeRequestSchema>;

/** POST /api/clans/leader */
export const ClanLeaderRequestSchema = z.object({ userId: z.string().uuid(), clientId });
export type ClanLeaderRequest = z.infer<typeof ClanLeaderRequestSchema>;

/** GET /api/clans/search?q= (empty q lists clans by rank). */
export const ClanSearchQuerySchema = z.object({ q: z.string().trim().max(CLAN_NAME_MAX).default("") });

/** GET /api/clans/leaderboard?limit= */
export const ClanLeaderboardQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

/** A clan as anyone may see it (search). */
export const ClanSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tag: z.string(),
  memberCount: z.number().int().min(0),
  status: ClanStatusSchema,
  clanRank: z.number().int().min(1).nullable(),
});
export type ClanSummary = z.infer<typeof ClanSummarySchema>;

export const ClanSearchResponseSchema = z.object({ items: z.array(ClanSummarySchema) });
export type ClanSearchResponse = z.infer<typeof ClanSearchResponseSchema>;

/** A ranked clan on the global board (always scored). The clan score may be shown; member hidden scores never are. */
export const ClanLeaderboardItemSchema = ClanSummarySchema.extend({ clanScore: z.number() });
export const ClanLeaderboardResponseSchema = z.object({ items: z.array(ClanLeaderboardItemSchema) });
export type ClanLeaderboardItem = z.infer<typeof ClanLeaderboardItemSchema>;
export type ClanLeaderboardResponse = z.infer<typeof ClanLeaderboardResponseSchema>;

/** The viewer's own clan (members only: carries the invite code and the viewer's role). */
export const ClanSchema = ClanSummarySchema.extend({
  description: z.string().nullable(),
  /** Null until the first daily score, and while fewer than CLAN_SCORE_MIN_ACTIVE members are active. */
  clanScore: z.number().nullable(),
  /** Members active in the activity window at the last daily score. */
  activeMemberCount: z.number().int().min(0),
  raidWins: z.number().int().min(0),
  inviteCode: z.string(),
  createdAt: z.string(),
  myRole: ClanRoleSchema,
});
export type Clan = z.infer<typeof ClanSchema>;

/**
 * One member as a clanmate sees them: the clanmate projection (username always, rank, five domain scores, shadow
 * status), the role, the dead-weight flag and the 30-day quest completion rate (% only, never quest content).
 * `userId` addresses leader actions (remove, transfer) and is only ever sent to members of the same clan.
 */
export const ClanMemberSchema = z.object({
  userId: z.string().uuid(),
  isSelf: z.boolean(),
  profile: PublicProfileSchema,
  role: ClanRoleSchema,
  flagged: z.boolean(),
  /** Completed / resolved quests over the last 30 local days, 0–100; null with nothing resolved. */
  questCompletionRate30d: z.number().int().min(0).max(100).nullable(),
});
export type ClanMember = z.infer<typeof ClanMemberSchema>;

export const ClanDispatchSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  text: z.string(),
  createdAt: z.string(),
});
export type ClanDispatch = z.infer<typeof ClanDispatchSchema>;

export const RaidTypeSchema = z.enum(["domain", "discipline", "body", "score"]);
export type RaidType = z.infer<typeof RaidTypeSchema>;

/**
 * One clan in the viewer's raid group. Clan-level only: the metric is the clan's total (mind logs, body logs and
 * sessions, quest completion %, summed hidden-score movement); no member's contribution is ever shown.
 */
export const RaidStandingSchema = z.object({
  clanId: z.string().uuid(),
  name: z.string(),
  tag: z.string(),
  clanRank: z.number().int().min(1).nullable(),
  isMine: z.boolean(),
  /** Null while a score raid is live: its values could reveal a member's own movement (positions only until it resolves). */
  metricValue: z.number().nullable(),
  position: z.number().int().min(1),
});
export type RaidStanding = z.infer<typeof RaidStandingSchema>;

/** The viewer's clan's raid this week: live standings until the raid resolves at the next Monday 00:00 UTC. */
export const RaidSummarySchema = z.object({
  weekKey: z.string(),
  week: z.number().int(),
  type: RaidTypeSchema,
  startsAt: z.string(),
  endsAt: z.string(),
  resolved: z.boolean(),
  /** Best first; clans tied on a metric share a position. */
  standings: z.array(RaidStandingSchema),
  myPosition: z.number().int().min(1),
  myValue: z.number().nullable(),
});
export type RaidSummary = z.infer<typeof RaidSummarySchema>;

/** GET /api/clans/raid. `raid` is null without a clan or when the clan has no raid (forming, or no rival clan). */
export const RaidResponseSchema = z.object({ raid: RaidSummarySchema.nullable() });
export type RaidResponse = z.infer<typeof RaidResponseSchema>;

/** GET /api/clans/mine. `clan` is null (and the lists empty) when the viewer has no clan. `raid` is always null here: read GET /api/clans/raid. */
export const MyClanResponseSchema = z.object({
  clan: ClanSchema.nullable(),
  members: z.array(ClanMemberSchema),
  dispatches: z.array(ClanDispatchSchema),
  raid: RaidSummarySchema.nullable(),
});
export type MyClanResponse = z.infer<typeof MyClanResponseSchema>;

/** Clan peer ratings (SOCIAL, anonymous): rate up to 5 clanmates a week (engine PEER_RATINGS_PER_WEEK), 1-5. */
export const PEER_RATING_MIN = 1;
export const PEER_RATING_MAX = 5;

/** POST /api/clans/ratings. Re-rating the same clanmate in the week replaces the value. */
export const PeerRatingRequestSchema = z.object({
  rateeUserId: z.string().uuid(),
  rating: z.number().int().min(PEER_RATING_MIN).max(PEER_RATING_MAX),
  clientId,
});
export type PeerRatingRequest = z.infer<typeof PeerRatingRequestSchema>;

/**
 * GET /api/clans/ratings/mine and the POST response: what the viewer has given in their current local ISO week.
 * `rateeHandle` is the clanmate's username, or FORMER OPERATOR for someone no longer in the viewer's clan. Nobody
 * can read who rated them.
 */
export const PeerRatingsMineSchema = z.object({
  weekKey: z.string(),
  given: z.array(z.object({ rateeHandle: z.string(), rating: z.number().int().min(PEER_RATING_MIN).max(PEER_RATING_MAX) })),
  remaining: z.number().int().min(0).max(5),
});
export type PeerRatingsMine = z.infer<typeof PeerRatingsMineSchema>;
