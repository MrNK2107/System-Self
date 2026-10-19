/** Players matching a search (GET /api/social/search). */
export const socialSearchKey = (userId: string | null, q: string) => ["social-search", userId, q] as const;
/** Players the user follows (GET /api/social/following). */
export const followingKey = (userId: string | null) => ["social-following", userId] as const;
/** How many players follow the user (GET /api/social/followers/count). */
export const followersCountKey = (userId: string | null) => ["social-followers-count", userId] as const;
/** One player's profile (GET /api/social/profile/:handle). */
export const socialProfileKey = (userId: string | null, handle: string) => ["social-profile", userId, handle] as const;
/** Prefix of every social query, for invalidating them together. */
export const socialRootKeys = (userId: string | null) =>
  [
    ["social-search", userId],
    ["social-following", userId],
    ["social-followers-count", userId],
    ["social-profile", userId],
  ] as const;
