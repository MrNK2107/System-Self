/** The finance summary of the current local month (GET /api/finance/summary). */
export const financeKey = (userId: string | null) => ["finance-summary", userId] as const;
