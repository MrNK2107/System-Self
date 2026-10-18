import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type Db = NodePgDatabase<typeof schema>;

export function createDb(url: string): { db: Db; pool: pg.Pool } {
  const pool = new Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), pool };
}

export const hasDatabase = Boolean(process.env.DATABASE_URL);
const created = hasDatabase ? createDb(process.env.DATABASE_URL!) : null;
export const pool = created ? created.pool : null;
export const db = created ? created.db : null;

export * from "./schema";
