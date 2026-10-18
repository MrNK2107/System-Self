import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { createDb, type Db } from "./index";

let cached: Db | null = null;
let cachedPool: Pool | null = null;

function migrateOnce(url: string): void {
  // Synchronous on purpose so getTestDb() can stay sync: run the migrate script in a child process.
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "migrate.ts");
  const r = spawnSync(process.execPath, ["--import", "tsx", script], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error("test database migration failed");
}

export function getTestDb(): Db | null {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  if (!cached) {
    migrateOnce(url);
    const created = createDb(url);
    cached = created.db;
    cachedPool = created.pool;
  }
  return cached;
}

export async function resetDb(db: Db): Promise<void> {
  const res = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'`,
  );
  const names = res.rows.map((r) => `"${String((r as { tablename: string }).tablename)}"`);
  if (names.length === 0) return;
  await db.execute(sql.raw(`TRUNCATE ${names.join(", ")} RESTART IDENTITY CASCADE`));
}

export async function closeTestDb(): Promise<void> {
  const pool = cachedPool;
  cached = null;
  cachedPool = null;
  if (pool) await pool.end();
}
