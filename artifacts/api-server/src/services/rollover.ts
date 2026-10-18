import type { Db } from "@workspace/db";

/** On-demand catch-up of missed local days. Intentionally a no-op until the rollover service lands (Task 7). */
export async function ensureRolledOver(_db: Db, _userId: string, _now: Date): Promise<void> {}
