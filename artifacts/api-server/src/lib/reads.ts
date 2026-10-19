import { PgTransaction } from "drizzle-orm/pg-core";

type Thunks<T extends readonly unknown[]> = { [K in keyof T]: () => PromiseLike<T[K]> };

/** At most this many of one request's reads hold pool connections at once, so one request never drains the pool. */
export const READS_MAX_CONCURRENCY = 4;

/**
 * Runs independent reads concurrently (at most READS_MAX_CONCURRENCY at a time) when `db` is the pool, so a request
 * costs a few round trips instead of one per query, and one after another on a transaction: a transaction is one
 * client, and node-postgres deprecates (pg 9 removes) overlapping queries on a client. Results keep input order.
 */
export async function reads<const T extends readonly unknown[]>(db: object, thunks: Thunks<T>): Promise<T> {
  const list = thunks as unknown as readonly (() => PromiseLike<unknown>)[];
  const width = db instanceof PgTransaction ? 1 : READS_MAX_CONCURRENCY;
  const out: unknown[] = new Array(list.length);
  let next = 0;
  const lane = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await list[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, list.length) }, lane));
  return out as unknown as T;
}
