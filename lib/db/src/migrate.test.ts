import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { runMigrations, MIGRATION_LOCK_KEY } from "./migrate";

const base = process.env.TEST_DATABASE_URL;
const skip = base ? false : "TEST_DATABASE_URL not set";

async function freshDatabase(name: string): Promise<{ url: string; drop: () => Promise<void> }> {
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const u = new URL(base!);
  u.pathname = `/${name}`;
  return {
    url: u.toString(),
    drop: async () => {
      const a = new pg.Client({ connectionString: base });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

test("two concurrent migrations on a fresh database both succeed", { skip }, async () => {
  const f = await freshDatabase("system_self_migrate_lock_test");
  try {
    const results = await Promise.allSettled([runMigrations(f.url), runMigrations(f.url), runMigrations(f.url)]);
    for (const r of results) assert.equal(r.status, "fulfilled", r.status === "rejected" ? String(r.reason) : "");
    const c = new pg.Client({ connectionString: f.url });
    await c.connect();
    const { rows } = await c.query("select count(*)::int as n from drizzle.__drizzle_migrations");
    assert.ok(rows[0].n > 0);
    await c.end();
  } finally {
    await f.drop();
  }
});

test("a held advisory lock makes migrate wait, and it releases the lock afterwards", { skip }, async () => {
  const f = await freshDatabase("system_self_migrate_wait_test");
  try {
    const holder = new pg.Client({ connectionString: f.url });
    await holder.connect();
    await holder.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    let done = false;
    const run = runMigrations(f.url).then(() => {
      done = true;
    });
    // Wait until migrate is observably blocked on the advisory lock (bounded), instead of sleeping a fixed time.
    const deadline = Date.now() + 15_000;
    for (;;) {
      const { rows } = await holder.query(
        "select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted and database = (select oid from pg_database where datname = current_database())",
      );
      if (rows[0].n > 0) break;
      if (Date.now() > deadline) throw new Error("migrate never waited on the advisory lock");
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(done, false, "migrate must wait for the lock");
    await holder.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    await run;
    assert.equal(done, true);
    const got = await holder.query("select pg_try_advisory_lock($1) as ok", [MIGRATION_LOCK_KEY]);
    assert.equal(got.rows[0].ok, true, "lock released after migrate");
    await holder.end();
  } finally {
    await f.drop();
  }
});
