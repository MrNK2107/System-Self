import { sql } from "drizzle-orm";
import type { Db } from "@workspace/db";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Runs `fn` in a transaction holding a per-user advisory lock. Every score mutation goes through
 * here so concurrent writes for one user serialize (the lock is released at commit/rollback).
 */
export function withUserLock<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    return fn(tx);
  });
}
