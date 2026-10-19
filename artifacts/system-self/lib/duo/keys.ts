/** The viewer's Party of Two (GET /api/duo). */
export const duoKey = (userId: string | null) => ["duo", userId] as const;
