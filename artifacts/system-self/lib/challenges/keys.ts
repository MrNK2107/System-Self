/** The viewer's named challenges (GET /api/challenges). */
export const challengesKey = (userId: string | null) => ["challenges", userId] as const;
