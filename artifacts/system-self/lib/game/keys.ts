/** React Query key of the signed-in user's GameState (GET /api/state). */
export const gameStateKey = (userId: string | null) => ["game-state", userId] as const;
/** Recent logs (GET /api/logs). */
export const logsKey = (userId: string | null) => ["logs", userId] as const;
/** Active + recently resolved quests (GET /api/quests). */
export const questsKey = (userId: string | null) => ["quests", userId] as const;
/** Chain templates + active chains (GET /api/chains/templates). */
export const chainsKey = (userId: string | null) => ["chains", userId] as const;
/** Exercises, plans, recent sessions, PRs and body-part scores (GET /api/gym). */
export const gymKey = (userId: string | null) => ["gym", userId] as const;
/** The deferral ledger (GET /api/adherence/deferrals). */
export const deferralsKey = (userId: string | null) => ["deferrals", userId] as const;
/** Shadow takeover tally (GET /api/adherence/shadow-takeovers). */
export const shadowTakeoversKey = (userId: string | null) => ["shadow-takeovers", userId] as const;
/** Today's comeback checklist (GET /api/comeback). */
export const comebackKey = (userId: string | null) => ["comeback", userId] as const;
/** Active and scheduled seasons (GET /api/seasons). */
export const seasonsKey = (userId: string | null) => ["seasons", userId] as const;
/** Past You: baseline vs now (GET /api/progress/past-self). */
export const pastSelfKey = (userId: string | null) => ["past-self", userId] as const;
/** Further unseen notices (GET /api/notices), fetched only when the state says there are more. */
export const noticesKey = (userId: string | null) => ["notices", userId] as const;

/** Today's morning briefing (POST /api/messages). The date is the device's local date; the server caches it per day. */
export const briefingKey = (userId: string | null, date: string) => ["briefing", userId, date] as const;
/** GET /api/debrief/today. */
export const debriefKey = (userId: string | null) => ["debrief-today", userId] as const;
/** GET /api/recap/weekly. */
export const weeklyRecapKey = (userId: string | null) => ["recap-weekly", userId] as const;
/** GET /api/recap/weekly/debrief. */
export const weeklyDebriefKey = (userId: string | null) => ["recap-weekly-debrief", userId] as const;
/** GET /api/system/completions/summary. */
export const completionSummaryKey = (userId: string | null, days: number) => ["completion-summary", userId, days] as const;

/** The slice of QueryClient that invalidateGame needs. */
export interface Invalidator {
  invalidateQueries(filters: { queryKey: readonly unknown[] }): Promise<void> | void;
}

/** After any game mutation: refetch state, quests and notices (and the logs / chains / ledger views of them). */
export async function invalidateGame(client: Invalidator, userId: string | null): Promise<void> {
  const keys = [
    gameStateKey(userId),
    questsKey(userId),
    noticesKey(userId),
    logsKey(userId),
    chainsKey(userId),
    deferralsKey(userId),
    shadowTakeoversKey(userId),
    comebackKey(userId),
    pastSelfKey(userId),
  ];
  await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}

/** GET /api/gym/briefing (the date is "today" for the user, or an explicit YYYY-MM-DD). */
export const dungeonBriefingKey = (userId: string | null, date: string) => ["dungeon-briefing", userId, date] as const;
/** GET /api/gym/quiet-hours. */
export const quietHoursKey = (userId: string | null) => ["quiet-hours", userId] as const;
