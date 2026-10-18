/** React Query key of the signed-in user's GameState (GET /api/state). */
export const gameStateKey = (userId: string | null) => ["game-state", userId] as const;
