import { z } from "zod";

export const RANKED_DOMAIN_VALUES = ["BODY", "MIND", "WEALTH", "SOCIAL", "DISCIPLINE"] as const;
export const RankedDomainSchema = z.enum(RANKED_DOMAIN_VALUES);
export type RankedDomain = z.infer<typeof RankedDomainSchema>;

export const RankSchema = z.enum(["E", "D", "C", "B", "A", "S"]);
export type Rank = z.infer<typeof RankSchema>;

export const IdentitySettingSchema = z.enum(["anonymous", "semi-public", "public"]);

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

const IanaTimezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Unknown timezone" },
);

const RatingSchema = z.number().int().min(1).max(10);

export const OnboardingRequestSchema = z.object({
  ratings: z.object({
    BODY: RatingSchema,
    MIND: RatingSchema,
    WEALTH: RatingSchema,
    SOCIAL: RatingSchema,
    DISCIPLINE: RatingSchema,
  }),
  primaryGoal: z.string().trim().min(5).max(200),
  biggestWeakness: RankedDomainSchema,
  stoppedBefore: z.string().max(500).optional(),
  identitySetting: IdentitySettingSchema,
  morningTime: HHMM,
  nightlyTime: HHMM,
  timezone: IanaTimezoneSchema,
  clientId: z.string().min(1).max(200).optional(),
});
export type OnboardingRequest = z.infer<typeof OnboardingRequestSchema>;

export const NoticeSchema = z.object({
  id: z.string(),
  kind: z.string(),
  payload: z.unknown(),
  createdAt: z.string(),
});
export type Notice = z.infer<typeof NoticeSchema>;

export const TrajectorySchema = z.enum(["up", "stable", "down"]);

const ScoresRecordSchema = z.object({
  BODY: z.number(),
  MIND: z.number(),
  WEALTH: z.number(),
  SOCIAL: z.number(),
  DISCIPLINE: z.number(),
});

export const GameStateSchema = z.object({
  profile: z.object({
    username: z.string(),
    codename: z.string(),
    rank: RankSchema,
    rankSince: z.string(),
    identitySetting: IdentitySettingSchema,
    primaryGoal: z.string(),
    biggestWeakness: RankedDomainSchema,
    morningTime: z.string(),
    nightlyTime: z.string(),
    dayNumber: z.number().int(),
    onboarded: z.boolean(),
  }),
  scores: z.array(
    z.object({
      domain: RankedDomainSchema,
      score: z.number(),
      streak: z.number().int(),
      lastLogDate: z.string().nullable(),
    }),
  ),
  tierProgress: z.number(),
  trajectory: TrajectorySchema,
  shadow: z
    .object({
      active: z.boolean(),
      codename: z.string(),
      scores: ScoresRecordSchema,
      gap: z.number(),
      phase: z.enum(["DORMANT", "AWAKENED", "HUNTING", "DOMINANT"]),
      rank: RankSchema,
    })
    .nullable(),
  unseenNotices: z.array(NoticeSchema),
  today: z.string(),
});
export type GameState = z.infer<typeof GameStateSchema>;
