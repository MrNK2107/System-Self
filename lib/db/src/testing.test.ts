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
  await db.execute(
    sql`INSERT INTO system_messages (username, message_type, rank, trajectory, shadow_active, shadow_gap, day_number, message, model, prompt_version, attempts) VALUES ('u', 'k', 'E', 't', false, 0, 1, 'm', 'x', 'v1', 1)`,
  );
  await resetDb(db);
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM system_messages`);
  assert.equal(res.rows[0]!.n, 0);
});
