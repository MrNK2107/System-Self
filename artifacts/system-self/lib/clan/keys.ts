/** The user's clan, members and dispatches (GET /api/clans/mine). */
export const myClanKey = (userId: string | null) => ["clan-mine", userId] as const;
/** Clans matching a search (GET /api/clans/search). */
export const clanSearchKey = (userId: string | null, q: string) => ["clan-search", userId, q] as const;
/** The global clan board (GET /api/clans/leaderboard). */
export const clanLeaderboardKey = (userId: string | null) => ["clan-leaderboard", userId] as const;
/** The clan's weekly raid (GET /api/clans/raid). */
export const raidKey = (userId: string | null) => ["clan-raid", userId] as const;
/** What the viewer has rated this week (GET /api/clans/ratings/mine). */
export const ratingsKey = (userId: string | null) => ["clan-ratings", userId] as const;
/** Prefix of every clan query, for invalidating them together after a membership change. */
export const clanRootKeys = (userId: string | null) =>
  [
    ["clan-mine", userId],
    ["clan-search", userId],
    ["clan-leaderboard", userId],
    ["clan-raid", userId],
    ["clan-ratings", userId],
  ] as const;
