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

// --- logs, quests, chains, notices -----------------------------------------

const ClientIdSchema = z.string().min(1).max(200);

export const LogRequestSchema = z.object({
  clientId: ClientIdSchema,
  domain: RankedDomainSchema,
  logType: z.string().min(1).max(40),
  data: z
    .record(z.string(), z.unknown())
    .refine((v) => JSON.stringify(v).length <= 4096, { message: "data must be at most 4 KB" })
    .optional(),
  freeText: z.string().max(2000).optional(),
  forbidden: z.boolean().optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});
export type LogRequest = z.infer<typeof LogRequestSchema>;

export const LogSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  domain: RankedDomainSchema,
  logType: z.string(),
  data: z.unknown(),
  freeText: z.string().nullable(),
  forbidden: z.boolean(),
  occurredAt: z.string(),
  localDate: z.string(),
  isRetroactive: z.boolean(),
  createdAt: z.string(),
});
export type GameLog = z.infer<typeof LogSchema>;

export const ScoreResultSchema = z.object({
  domain: RankedDomainSchema,
  actualDelta: z.number(),
  score: z.number(),
  streak: z.number().int(),
});

export const LogResponseSchema = z.object({
  log: LogSchema,
  results: z.array(ScoreResultSchema),
  notices: z.array(NoticeSchema),
});

export const LogListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(200).optional(),
});

export const LogListResponseSchema = z.object({
  items: z.array(LogSchema),
  nextCursor: z.string().nullable(),
});

export const QuestSchema = z.object({
  id: z.string(),
  type: z.enum(["daily", "weekly", "arc"]),
  title: z.string(),
  description: z.string(),
  domain: z.string(),
  status: z.enum(["active", "complete", "failed", "refused"]),
  expiresAt: z.string(),
  resolvedAt: z.string().nullable(),
  chainId: z.string().nullable(),
  chainStep: z.number().int().nullable(),
  chainTotal: z.number().int().nullable(),
  refusalReason: z.string().nullable(),
  createdAt: z.string(),
});
export type GameQuest = z.infer<typeof QuestSchema>;

export const QuestListResponseSchema = z.object({
  active: z.array(QuestSchema),
  recent: z.array(QuestSchema),
});

export const QuestCompleteRequestSchema = z.object({ clientId: ClientIdSchema.optional() });
export const QuestCompleteResponseSchema = z.object({
  quest: QuestSchema,
  results: z.array(ScoreResultSchema),
  notices: z.array(NoticeSchema),
});

export const QuestRefuseRequestSchema = z.object({
  reason: z.string().max(200).optional(),
  clientId: ClientIdSchema.optional(),
});
export const QuestRefuseResponseSchema = z.object({
  quest: QuestSchema,
  penalty: z.number(),
  results: z.array(ScoreResultSchema),
});

export const CHAIN_TEMPLATE_KEYS = ["physical_protocol", "mind_sharpening", "wealth_accumulation", "discipline_forge"] as const;
export const ChainTemplateKeySchema = z.enum(CHAIN_TEMPLATE_KEYS);

export const ChainStartRequestSchema = z.object({
  templateKey: ChainTemplateKeySchema,
  clientId: ClientIdSchema.optional(),
});

export const ChainTemplatesResponseSchema = z.object({
  templates: z.array(
    z.object({
      templateKey: z.string(),
      name: z.string(),
      description: z.string(),
      domain: RankedDomainSchema,
      steps: z.array(z.object({ title: z.string(), description: z.string(), reward: z.string() })),
    }),
  ),
  active: z.array(z.object({ templateKey: z.string(), currentStep: z.number().int() })),
});

export const ChainStartResponseSchema = z.object({
  chain: z.object({
    id: z.string(),
    templateKey: z.string(),
    name: z.string(),
    domain: RankedDomainSchema,
    currentStep: z.number().int(),
    totalSteps: z.number().int(),
    status: z.string(),
    startedAt: z.string(),
  }),
  quest: QuestSchema,
});

export const NoticeListResponseSchema = z.object({ items: z.array(NoticeSchema) });

export const NoticesSeenRequestSchema = z.object({
  ids: z.array(z.string().uuid()).max(100),
  clientId: ClientIdSchema.optional(),
});

/** Notice kinds written by the server. */
export const NOTICE_KINDS = ["achievement", "milestone", "rank_change", "chain_complete"] as const;
