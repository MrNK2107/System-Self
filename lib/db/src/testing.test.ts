import { after, test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "./testing";

after(() => closeTestDb());

test("resetDb truncates rows", async (t) => {
  const db = getTestDb();
  if (!db) {
    t.skip("TEST_DATABASE_URL not set");
    return;
  }
  await resetDb(db);
  const u = await db.execute(
    sql`INSERT INTO users (email, password_hash, username, birth_year, terms_accepted_at) VALUES ('t@x.com', 'h', 'tt', 1990, now()) RETURNING id`,
  );
  const userId = u.rows[0]!.id as string;
  await db.execute(
    sql`INSERT INTO system_messages (user_id, message_type, rank, trajectory, shadow_active, shadow_gap, day_number, message, model, prompt_version, attempts) VALUES (${userId}, 'k', 'E', 't', false, 0, 1, 'm', 'x', 'v1', 1)`,
  );
  await resetDb(db);
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM system_messages`);
  assert.equal(res.rows[0]!.n, 0);
});
