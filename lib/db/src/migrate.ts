import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./index";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Session-level advisory lock key held while migrating, so concurrent migrators run one at a time. */
export const MIGRATION_LOCK_KEY = 7_265_390_417;

/**
 * Source tree: ../migrations. Bundled image: a `migrations` folder next to dist/migrate.mjs.
 * MIGRATIONS_DIR overrides both.
 */
function resolveMigrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return path.resolve(process.env.MIGRATIONS_DIR);
  const beside = path.resolve(here, "migrations");
  return existsSync(beside) ? beside : path.resolve(here, "../migrations");
}

export async function runMigrations(url: string): Promise<void> {
  const { db, pool } = createDb(url);
  // The lock lives on one dedicated connection; drizzle migrates over the pool's other connections.
  const lock = await pool.connect();
  try {
    await lock.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await migrate(db, { migrationsFolder: resolveMigrationsFolder() });
    } finally {
      await lock.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    lock.release();
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  runMigrations(url).then(
    () => console.log("migrations applied"),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
