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
/** A member with this many consecutive inactive local days is dead weight (flagged, excluded from the score). */
export const CLAN_INACTIVE_DAYS = 5;

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

/** A ranked (active) clan on the global board. The clan score may be shown; member hidden scores never are. */
export const ClanLeaderboardItemSchema = ClanSummarySchema.extend({ clanScore: z.number() });
export const ClanLeaderboardResponseSchema = z.object({ items: z.array(ClanLeaderboardItemSchema) });
export type ClanLeaderboardItem = z.infer<typeof ClanLeaderboardItemSchema>;
export type ClanLeaderboardResponse = z.infer<typeof ClanLeaderboardResponseSchema>;

/** The viewer's own clan (members only: carries the invite code and the viewer's role). */
export const ClanSchema = ClanSummarySchema.extend({
  description: z.string().nullable(),
  clanScore: z.number(),
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

/** GET /api/clans/mine. `clan` is null (and the lists empty) when the viewer has no clan. `raid` arrives with raids (Task 5). */
export const MyClanResponseSchema = z.object({
  clan: ClanSchema.nullable(),
  members: z.array(ClanMemberSchema),
  dispatches: z.array(ClanDispatchSchema),
  raid: z.null(),
});
export type MyClanResponse = z.infer<typeof MyClanResponseSchema>;

/** Error codes the clan routes answer with. */
export const CLAN_ERROR_CODES = [
  "email_unverified",
  "already_in_clan",
  "clan_full",
  "leader_must_transfer",
  "not_flagged",
  "not_leader",
  "not_in_clan",
  "name_taken",
  "blocked",
  "self_target",
  "not_found",
] as const;
