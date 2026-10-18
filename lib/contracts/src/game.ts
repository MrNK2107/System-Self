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

/** Notice kinds written by the server. */
export const NOTICE_KINDS = [
  "achievement",
  "milestone",
  "rank_change",
  "chain_complete",
  "quest_failed",
  "streak_break",
  "shadow_activated",
  "shadow_resolved",
] as const;
export const NoticeKindSchema = z.enum(NOTICE_KINDS);
export type NoticeKind = z.infer<typeof NoticeKindSchema>;

export const QuestTypeSchema = z.enum(["daily", "weekly", "arc"]);

/** The payload the server writes for each notice kind. */
export const NOTICE_PAYLOAD_SCHEMAS = {
  achievement: z.object({ id: z.string(), title: z.string(), description: z.string(), icon: z.string() }),
  milestone: z.object({ domain: RankedDomainSchema, tier: z.number().int(), title: z.string() }),
  rank_change: z.object({
    from: RankSchema,
    to: RankSchema,
    kind: z.enum(["promotion", "demotion"]),
    newCodename: z.string(),
  }),
  chain_complete: z.object({ name: z.string(), templateKey: z.string() }),
  quest_failed: z.object({ questId: z.string(), title: z.string(), type: QuestTypeSchema, penalty: z.number() }),
  streak_break: z.object({
    domains: z.array(z.object({ domain: RankedDomainSchema, lostStreak: z.number().int() })),
    penalty: z.number(),
  }),
  shadow_activated: z.object({ gap: z.number(), codename: z.string() }),
  shadow_resolved: z.object({ codename: z.string() }),
} as const satisfies Record<NoticeKind, z.ZodTypeAny>;

const noticeOf = <K extends NoticeKind>(kind: K) =>
  z.object({ id: z.string(), kind: z.literal(kind), payload: NOTICE_PAYLOAD_SCHEMAS[kind], createdAt: z.string() });

export const NoticeSchema = z.discriminatedUnion("kind", [
  noticeOf("achievement"),
  noticeOf("milestone"),
  noticeOf("rank_change"),
  noticeOf("chain_complete"),
  noticeOf("quest_failed"),
  noticeOf("streak_break"),
  noticeOf("shadow_activated"),
  noticeOf("shadow_resolved"),
]);
export type Notice = z.infer<typeof NoticeSchema>;
export type NoticePayload<K extends NoticeKind> = z.infer<(typeof NOTICE_PAYLOAD_SCHEMAS)[K]>;

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
    .refine((v) => new TextEncoder().encode(JSON.stringify(v)).length <= 4096, { message: "data must be at most 4 KB" })
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
  type: QuestTypeSchema,
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


// --- gym -------------------------------------------------------------------

export const WeekdaySchema = z.enum(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]);

export const PlanBlockSchema = z.object({
  exerciseId: z.string().min(1).max(100),
  sets: z.number().int().min(1).max(20),
  repRange: z.string().min(1).max(20),
  restSec: z.number().int().min(0).max(1800),
  notes: z.string().max(500).optional(),
});

export const PlanDaySchema = z.object({
  weekday: WeekdaySchema,
  blocks: z.array(PlanBlockSchema).max(12),
});

const PlanDaysSchema = z
  .array(PlanDaySchema)
  .max(7)
  .refine((d) => new Set(d.map((x) => x.weekday)).size === d.length, { message: "Weekdays must be unique" });

export const PlanCreateRequestSchema = z.object({
  name: z.string().min(1).max(80),
  goal: z.string().max(200),
  days: PlanDaysSchema,
  clientId: ClientIdSchema.optional(),
});

export const PlanPatchRequestSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  goal: z.string().max(200).optional(),
  days: PlanDaysSchema.optional(),
  isActive: z.boolean().optional(),
  clientId: ClientIdSchema.optional(),
});

export const SessionCreateRequestSchema = z.object({
  clientId: ClientIdSchema,
  planId: z.string().uuid().optional(),
});

export const SetCreateRequestSchema = z.object({
  exerciseId: z.string().min(1).max(100),
  reps: z.number().int().min(0).max(200),
  weight: z.number().min(0).max(1000),
  completed: z.boolean(),
  setIndex: z.number().int().min(0).max(1000).optional(),
  clientId: ClientIdSchema.optional(),
});

export const SessionCompleteRequestSchema = z.object({ clientId: ClientIdSchema.optional() });

export const ExerciseSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  name: z.string(),
  primaryBodyPart: z.string(),
  secondaryBodyParts: z.array(z.string()),
  isBig5: z.boolean(),
});

export const PlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string(),
  days: z.array(PlanDaySchema),
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type GymPlan = z.infer<typeof PlanSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  planId: z.string().nullable(),
  clientId: z.string(),
  localDate: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  points: z.number(),
});
export type GymSession = z.infer<typeof SessionSchema>;

export const SetSchema = z.object({
  id: z.number().int(),
  sessionId: z.string(),
  exerciseId: z.string(),
  setIndex: z.number().int(),
  reps: z.number().int(),
  weight: z.number(),
  completed: z.boolean(),
});
export type GymSet = z.infer<typeof SetSchema>;

export const PersonalRecordSchema = z.object({
  exerciseId: z.string(),
  value: z.number(),
  reps: z.number().int(),
  weight: z.number(),
  achievedAt: z.string(),
});

export const GymResponseSchema = z.object({
  exercises: z.array(ExerciseSchema),
  plans: z.array(PlanSchema),
  activePlanId: z.string().nullable(),
  recentSessions: z.array(SessionSchema),
  personalRecords: z.array(PersonalRecordSchema),
  bodyPartScores: z.array(z.object({ bodyPart: z.string(), points: z.number(), updatedAt: z.string() })),
});

export const SessionCompleteResponseSchema = z.object({
  session: SessionSchema,
  points: z.number(),
  byBodyPart: z.record(z.string(), z.number()),
  newPrs: z.array(PersonalRecordSchema.extend({ name: z.string(), previous: z.number().nullable() })),
  results: z.array(ScoreResultSchema),
  notices: z.array(NoticeSchema),
});

// --- quest generation, messages, debriefs, recaps --------------------------

export const QuestGenerateResponseSchema = z.object({
  active: z.array(QuestSchema),
  generated: z.boolean(),
});

export const MESSAGE_TYPES = [
  "morning_briefing",
  "nightly_debrief",
  "quest_assignment",
  "rank_change",
  "shadow_self",
  "milestone",
  "failure_response",
  "streak_break",
  "shadow_confrontation",
  "rival_taunt",
  "chain_complete",
  "domain_milestone",
  "forbidden_log",
  "rank_up_prep",
  "weekly_debrief",
] as const;
export const MessageTypeSchema = z.enum(MESSAGE_TYPES);
export type MessageType = z.infer<typeof MessageTypeSchema>;

/** The server builds all context itself; the client only names the message and may add a short note. */
export const MessageRequestSchema = z.object({
  type: MessageTypeSchema,
  extraContext: z.string().max(500).optional(),
  clientId: ClientIdSchema.optional(),
});

export const AiMetaSchema = z.object({
  promptVersion: z.string().min(1),
  model: z.string().min(1),
  attempts: z.number().int().min(1),
});

export const MessageResponseSchema = z.object({ message: z.string(), meta: AiMetaSchema });

export const DebriefSchema = z.object({
  date: z.string(),
  deltas: ScoresRecordSchema,
  questCompleted: z.number().int(),
  questTotal: z.number().int(),
  verdict: z.enum(["ACCEPTABLE", "INSUFFICIENT", "PATHETIC"]),
  text: z.string(),
  acknowledged: z.boolean(),
});

export const DebriefTodayResponseSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(false), availableAt: z.string() }),
  z.object({ available: z.literal(true), debrief: DebriefSchema }),
]);

export const WeeklyRecapSchema = z.object({
  weekStart: z.string(),
  domainDeltas: ScoresRecordSchema,
  questsCompleted: z.number().int(),
  questsFailed: z.number().int(),
  questsRefused: z.number().int(),
  logsCount: z.number().int(),
  forbiddenLogs: z.number().int(),
  peakDomain: RankedDomainSchema.nullable(),
  chainsCompleted: z.number().int(),
  achievementsUnlocked: z.number().int(),
});

export const WeeklyDebriefResponseSchema = z.object({
  weekStart: z.string(),
  debrief: z.string(),
  meta: AiMetaSchema,
});
