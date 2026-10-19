import { z } from "zod";

export const RANKED_DOMAIN_VALUES = ["BODY", "MIND", "WEALTH", "SOCIAL", "DISCIPLINE"] as const;
export const RankedDomainSchema = z.enum(RANKED_DOMAIN_VALUES);
export type RankedDomain = z.infer<typeof RankedDomainSchema>;

export const RankSchema = z.enum(["E", "D", "C", "B", "A", "S"]);
export type Rank = z.infer<typeof RankSchema>;

export const IdentitySettingSchema = z.enum(["anonymous", "semi-public", "public"]);

export const LIFE_CONTEXT_VALUES = ["student", "professional", "shift_worker", "athlete", "founder", "parent", "traveling"] as const;
export const LifeContextSchema = z.enum(LIFE_CONTEXT_VALUES);
export type LifeContext = z.infer<typeof LifeContextSchema>;

export const SEASON_KIND_VALUES = ["exam", "crunch", "competition", "launch", "away"] as const;
export const SeasonKindSchema = z.enum(SEASON_KIND_VALUES);
export type SeasonKind = z.infer<typeof SeasonKindSchema>;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

/** The runtime's canonical spelling of an IANA zone ("america/new_york" -> "America/New_York"), or null if unknown. */
export function canonicalTimezone(tz: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** An IANA timezone, transformed to its canonical spelling. */
export const TimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .transform((tz, ctx) => {
    const canonical = canonicalTimezone(tz);
    if (canonical === null) {
      ctx.addIssue({ code: "custom", message: "Unknown timezone" });
      return z.NEVER;
    }
    return canonical;
  });

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
  timezone: TimezoneSchema,
  clientId: z.string().min(1).max(200).optional(),
  /** Start on the home path (Tier I home sessions before the gym). */
  homePathActive: z.boolean().optional(),
  /** Life context shaping quest content (default student). */
  lifeContext: LifeContextSchema.optional(),
});
export type OnboardingRequest = z.infer<typeof OnboardingRequestSchema>;

/** PATCH /api/profile: any subset of these, at least one. */
export const ProfileUpdateSchema = z
  .object({
    morningTime: HHMM,
    nightlyTime: HHMM,
    identitySetting: IdentitySettingSchema,
    primaryGoal: z.string().trim().min(5).max(200),
    lifeContext: LifeContextSchema,
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update" });
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;

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
  "comeback",
  "returner_mark",
  "gym_unlocked",
  "rival_passed",
  "rival_challenge_result",
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
  comeback: z.object({ gapDays: z.number().int(), line: z.string(), offerHomePath: z.boolean() }),
  returner_mark: z.object({ count: z.number().int(), line: z.string() }),
  gym_unlocked: z.object({ line: z.string() }),
  /** A rival's domain score passed the user's at a rollover (once until the order flips back). */
  rival_passed: z.object({ codename: z.string(), domain: RankedDomainSchema }),
  /** A rival challenge resolved (no score effect). Marking it seen acknowledges the challenge. */
  rival_challenge_result: z.object({
    challengeId: z.string(),
    codename: z.string(),
    domain: RankedDomainSchema,
    outcome: z.enum(["win", "loss", "draw"]),
    startDate: z.string(),
    endDate: z.string(),
    userStart: z.number(),
    userEnd: z.number(),
    rivalStart: z.number(),
    rivalEnd: z.number(),
  }),
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
  noticeOf("comeback"),
  noticeOf("returner_mark"),
  noticeOf("gym_unlocked"),
  noticeOf("rival_passed"),
  noticeOf("rival_challenge_result"),
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
    /** The user's own public codename (`USER // WORD-N`): how semi-public and anonymous players are found. Self only. */
    publicCodename: z.string(),
    rank: RankSchema,
    rankSince: z.string(),
    identitySetting: IdentitySettingSchema,
    primaryGoal: z.string(),
    biggestWeakness: RankedDomainSchema,
    morningTime: z.string(),
    nightlyTime: z.string(),
    dayNumber: z.number().int(),
    onboarded: z.boolean(),
    /** True while BODY quests are generated as home sessions (Tier I). */
    homePathActive: z.boolean(),
    lifeContext: LifeContextSchema,
    /** The season running today, or null. */
    season: z.object({ kind: SeasonKindSchema, endsOn: z.string(), line: z.string() }).nullable(),
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
  /** At most NOTICE_PAGE_SIZE, oldest first; `hasMoreNotices` when more are unseen. */
  unseenNotices: z.array(NoticeSchema),
  hasMoreNotices: z.boolean(),
  achievements: z.array(z.object({ id: z.string(), unlockedAt: z.string() })),
  milestones: z.array(z.object({ domain: RankedDomainSchema, tier: z.number().int(), unlockedAt: z.string() })),
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
  slotStart: z.string().nullable(),
  slotEnd: z.string().nullable(),
  /** Computed from the user's local now on GET /quests; "none" everywhere else. */
  slotState: z.enum(["none", "upcoming", "open", "missed"]),
  createdAt: z.string(),
});
export type GameQuest = z.infer<typeof QuestSchema>;

/** Lock the Slot: both times (end after start, same day, at most 4 h) or `{ slotStart: null }` to clear. */
export const QuestSlotRequestSchema = z.union([
  z.object({ slotStart: z.null(), clientId: ClientIdSchema.optional() }),
  z.object({ slotStart: HHMM, slotEnd: HHMM, clientId: ClientIdSchema.optional() }),
]);
export const QuestSlotResponseSchema = z.object({ quest: QuestSchema });

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

/** Refusing needs a typed reason: 1-200 characters after trim (a blank one is 400 reason_required). */
export const QuestRefuseRequestSchema = z.object({
  reason: z.string().trim().min(1).max(200),
  clientId: ClientIdSchema.optional(),
});

export const FloorRoutineSchema = z.object({
  id: z.string(),
  title: z.string(),
  minutes: z.number().int(),
  steps: z.array(z.object({ name: z.string(), seconds: z.number().int() })),
});
export type FloorRoutineDto = z.infer<typeof FloorRoutineSchema>;

export const QuestRefuseResponseSchema = z.object({
  quest: QuestSchema,
  penalty: z.number(),
  results: z.array(ScoreResultSchema),
  notices: z.array(NoticeSchema),
  /** Set for a refused BODY quest: a short bodyweight routine to do now. Null for every other domain. */
  floor: FloorRoutineSchema.nullable(),
  /** Set for a refused BODY quest: the Shadow Self "took" the session. Narrative only. */
  shadowTook: z.object({ questTitle: z.string() }).nullable(),
});

export const DeferralsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(7),
});
export const DeferralsResponseSchema = z.object({
  items: z.array(z.object({ questTitle: z.string(), domain: z.string(), reason: z.string(), localDate: z.string() })),
  countThisWeek: z.number().int(),
});

export const ShadowTakeoversQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export const ShadowTakeoversResponseSchema = z.object({
  items: z.array(z.object({ questTitle: z.string(), localDate: z.string() })),
  count: z.number().int(),
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

/** Unseen notices, oldest first, at most NOTICE_PAGE_SIZE; `hasMore` when newer unseen ones are waiting after them. */
export const NOTICE_PAGE_SIZE = 50;
/**
 * `?kinds=a,b` / `?noticeKinds=a,b`: only these notice kinds are returned and paged. Absent means every kind; names
 * this server does not know are dropped, so a list of only unknown kinds matches nothing.
 */
export const NoticeKindsParamSchema = z
  .string()
  .max(500)
  .transform((raw) => {
    const known = new Set<string>(NOTICE_KINDS);
    return [...new Set(raw.split(",").map((k) => k.trim()))].filter((k): k is NoticeKind => known.has(k));
  })
  .optional();
export const NoticeListQuerySchema = z.object({ kinds: NoticeKindsParamSchema });
export const StateQuerySchema = z.object({ noticeKinds: NoticeKindsParamSchema });
export const NoticeListResponseSchema = z.object({ items: z.array(NoticeSchema), hasMore: z.boolean() });

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

// --- dungeon briefing and scout reports -------------------------------------

export const BriefingQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (d) => {
        const t = Date.parse(`${d}T00:00:00Z`);
        return !Number.isNaN(t) && new Date(t).toISOString().startsWith(d);
      },
      { message: "Invalid date" },
    )
    .optional(),
});

export const BriefingBlockSchema = z.object({
  exerciseId: z.string(),
  name: z.string(),
  sets: z.number().int(),
  repRange: z.string(),
  restSec: z.number().int(),
  howTo: z.string(),
  fallbacks: z.array(z.object({ exerciseId: z.string(), name: z.string() })),
});

export const BriefingResponseSchema = z.object({
  date: z.string(),
  source: z.enum(["plan", "beginner"]),
  blocks: z.array(BriefingBlockSchema),
  estimatedMinutes: z.number().int(),
});
export type GymBriefing = z.infer<typeof BriefingResponseSchema>;

export const CrowdLevelSchema = z.enum(["quiet", "normal", "packed"]);

export const CrowdReportRequestSchema = z.object({
  level: CrowdLevelSchema,
  sessionId: z.string().uuid().optional(),
  clientId: ClientIdSchema.optional(),
});

export const CrowdReportResponseSchema = z.object({
  ok: z.literal(true),
  weekday: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
});

export const QuietHoursResponseSchema = z.object({
  suggestions: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
      quietShare: z.number().min(0).max(1),
    }),
  ),
  needed: z.number().int().min(0),
});
export type QuietHours = z.infer<typeof QuietHoursResponseSchema>;

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

// --- stats -----------------------------------------------------------------

const StatusCountSchema = { status: z.enum(["complete", "failed", "refused"]), count: z.number().int() };

/** GET /api/system/completions/summary: the requester's resolved quests over the last `windowDays` local days. */
export const CompletionSummarySchema = z.object({
  windowDays: z.number().int(),
  from: z.string(),
  to: z.string(),
  attempts: z.number().int(),
  completed: z.number().int(),
  completionRate: z.number().int(),
  byDomain: z.array(z.object({ domain: z.string(), ...StatusCountSchema })),
  daily: z.array(z.object({ day: z.string(), ...StatusCountSchema })),
});

// --- comeback and home path -------------------------------------------------

export const ComebackResponseSchema = z.object({
  active: z
    .object({
      gapDays: z.number().int(),
      checklist: z.array(z.object({ key: z.string(), label: z.string(), done: z.boolean() })),
    })
    .nullable(),
  returnerCount: z.number().int(),
});
export type ComebackResponse = z.infer<typeof ComebackResponseSchema>;

export const HomePathRequestSchema = z.object({
  active: z.boolean(),
  clientId: ClientIdSchema.optional(),
});

// --- life context and seasons ----------------------------------------------

export const SeasonRequestSchema = z.object({
  kind: z.string().min(1).max(40),
  startsOn: z.string().min(1).max(20),
  lengthDays: z.number(),
});
export type SeasonRequest = z.infer<typeof SeasonRequestSchema>;

export const SeasonSchema = z.object({
  id: z.string(),
  kind: SeasonKindSchema,
  startsOn: z.string(),
  endsOn: z.string(),
  line: z.string(),
});
export type Season = z.infer<typeof SeasonSchema>;

export const SeasonsResponseSchema = z.object({
  active: SeasonSchema.nullable(),
  scheduled: SeasonSchema.nullable(),
  availableKinds: z.array(SeasonKindSchema),
  /** The earliest start date a new season may have (tomorrow, or when the cooldown clears), in the user's timezone. */
  earliestStart: z.string(),
});
export type SeasonsResponse = z.infer<typeof SeasonsResponseSchema>;

// --- Past You and adherence metrics ----------------------------------------

const DomainScoresSchema = z.object({
  BODY: z.number(),
  MIND: z.number(),
  WEALTH: z.number(),
  SOCIAL: z.number(),
  DISCIPLINE: z.number(),
});

/** GET /api/progress/past-self: the user's own earliest snapshot next to today. Read-only. */
export const PastSelfResponseSchema = z.object({
  baselineDate: z.string(),
  /** "DAY 1" when the baseline is the onboarding day, otherwise "SINCE {date}". */
  label: z.string(),
  baseline: DomainScoresSchema,
  current: DomainScoresSchema,
  gym: z.object({
    /** Completed workout sessions, all time. */
    sessionsTotal: z.number().int(),
    /** Exercises with a personal record on file (one best per exercise, so not a count of improvements). */
    exercisesWithPr: z.number().int(),
  }),
});
export type PastSelfResponse = z.infer<typeof PastSelfResponseSchema>;

export const AdherenceMetricsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

/**
 * GET /api/admin/metrics/adherence?days=30. Ratios are 0 when their denominator is 0. secondVisitRate and
 * comebackRate are right-censored (only returns/comebacks at least 7 days old count). deferralsPerActiveUser counts
 * only refusals by users who logged anything in the window. Definitions: services/adherence-metrics.ts.
 */
export const AdherenceMetricsResponseSchema = z.object({
  floorOffered: z.number().int(),
  floorCompleted: z.number().int(),
  floorUptake: z.number(),
  secondVisitRate: z.number(),
  comebackRate: z.number(),
  deferralsPerActiveUser: z.number(),
});
export type AdherenceMetricsResponse = z.infer<typeof AdherenceMetricsResponseSchema>;
