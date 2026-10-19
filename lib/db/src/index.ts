import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type Db = NodePgDatabase<typeof schema>;

const DEFAULT_POOL_MAX = 10;

/** DB_POOL_MAX (validated by the API's env schema); anything unusable falls back to 10. */
export function poolMaxFromEnv(source: NodeJS.ProcessEnv): number {
  const n = Number(source.DB_POOL_MAX);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_POOL_MAX;
}

export function createDb(url: string, opts: { max?: number } = {}): { db: Db; pool: pg.Pool } {
  const pool = new Pool({ connectionString: url, max: opts.max ?? poolMaxFromEnv(process.env) });
  return { db: drizzle(pool, { schema }), pool };
}

export const hasDatabase = Boolean(process.env.DATABASE_URL);
const created = hasDatabase ? createDb(process.env.DATABASE_URL!) : null;
export const pool = created ? created.pool : null;
export const db = created ? created.db : null;

export * from "./schema";
