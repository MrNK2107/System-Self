import { z } from "zod";

/** Rank Freeze (PRO): lasts 7 local days, once per local calendar month. The line the app shows while one is active. */
export const RANK_FREEZE_DAYS = 7;
export const RANK_FREEZE_ACTIVE_LINE = "Rank Freeze active. The clock is paused. You are not.";
export const FREEZE_USED_CODE = "freeze_used";
export const FREEZE_ACTIVE_CODE = "freeze_active";
export const FREEZE_COOLDOWN_CODE = "freeze_cooldown";
/** Unfrozen local days that must separate two freezes: the next may start no earlier than the previous `until` + 8. */
export const RANK_FREEZE_COOLDOWN_DAYS = 7;

export const RankFreezeRequestSchema = z.object({ reason: z.string().trim().min(1).max(120) });
export type RankFreezeRequest = z.infer<typeof RankFreezeRequestSchema>;

export const RankFreezeResponseSchema = z.object({ until: z.string() });
export type RankFreezeResponse = z.infer<typeof RankFreezeResponseSchema>;

/** GET /api/rank-freeze. `until` is the inclusive last frozen local day (null with no freeze today). `availableFrom` is the earliest local day a POST would succeed (next month start if this month is used, the day after an active freeze, and the cooldown end, whichever is latest); null means a freeze can be started now. */
export const RankFreezeStatusSchema = z.object({
  active: z.boolean(),
  until: z.string().nullable(),
  usedThisMonth: z.boolean(),
  availableFrom: z.string().nullable(),
});
export type RankFreezeStatus = z.infer<typeof RankFreezeStatusSchema>;

/** Free users see 14 days of history, PRO up to 365. */
export const FREE_HISTORY_DAYS = 14;
export const PRO_HISTORY_DAYS = 365;

const ScoreMapSchema = z.record(z.string(), z.number());

/** GET /api/history/scores: daily domain scores and rank only (never the hidden score). `days` is the window actually served. */
export const ScoreHistorySchema = z.object({
  days: z.number().int(),
  /** The window served, inclusive local dates: charts place a day by its offset from `from`, so missing days show as gaps. */
  from: z.string(),
  to: z.string(),
  maxDays: z.number().int(),
  items: z.array(z.object({ date: z.string(), rank: z.string(), scores: ScoreMapSchema })),
});
export type ScoreHistory = z.infer<typeof ScoreHistorySchema>;

/** GET /api/history/quests: daily completion trend over rank-counting quests (bonus quests excluded). */
export const QuestTrendSchema = z.object({
  days: z.number().int(),
  from: z.string(),
  to: z.string(),
  maxDays: z.number().int(),
  items: z.array(z.object({ date: z.string(), completed: z.number().int(), resolved: z.number().int() })),
});
export type QuestTrend = z.infer<typeof QuestTrendSchema>;
