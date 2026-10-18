/** React Query key of the signed-in user's GameState (GET /api/state). */
export const gameStateKey = (userId: string | null) => ["game-state", userId] as const;
/** Recent logs (GET /api/logs). */
export const logsKey = (userId: string | null) => ["logs", userId] as const;
/** Active + recently resolved quests (GET /api/quests). */
export const questsKey = (userId: string | null) => ["quests", userId] as const;
/** Chain templates + active chains (GET /api/chains/templates). */
export const chainsKey = (userId: string | null) => ["chains", userId] as const;
/** Further unseen notices (GET /api/notices), fetched only when the state says there are more. */
export const noticesKey = (userId: string | null) => ["notices", userId] as const;

/** The slice of QueryClient that invalidateGame needs. */
export interface Invalidator {
  invalidateQueries(filters: { queryKey: readonly unknown[] }): Promise<void> | void;
}

/** After any game mutation: refetch state, quests and notices (and the logs / chains views of them). */
export async function invalidateGame(client: Invalidator, userId: string | null): Promise<void> {
  const keys = [gameStateKey(userId), questsKey(userId), noticesKey(userId), logsKey(userId), chainsKey(userId)];
  await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}
