import { PgTransaction } from "drizzle-orm/pg-core";

type Thunks<T extends readonly unknown[]> = { [K in keyof T]: () => PromiseLike<T[K]> };

/**
 * Runs independent reads concurrently when `db` is the pool (each read takes its own connection, so a request costs a
 * few round trips instead of one per query), and one after another on a transaction: a transaction is one client, and
 * node-postgres deprecates (pg 9 removes) overlapping queries on a client.
 */
export async function reads<const T extends readonly unknown[]>(db: object, thunks: Thunks<T>): Promise<T> {
  const list = thunks as unknown as readonly (() => PromiseLike<unknown>)[];
  if (db instanceof PgTransaction) {
    const out: unknown[] = [];
    for (const read of list) out.push(await read());
    return out as unknown as T;
  }
  return (await Promise.all(list.map((read) => read()))) as unknown as T;
}
