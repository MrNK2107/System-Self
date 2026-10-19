import test, { after } from "node:test";
import assert from "node:assert/strict";
import { closeTestDb, getTestDb } from "@workspace/db/testing";
import { postgresKnowsTimezone } from "./timezone";

const db = getTestDb();
const skip = db ? false : "TEST_DATABASE_URL not set";
after(async () => {
  await closeTestDb();
});

test("postgresKnowsTimezone asks Postgres: known zones true, unknown false (no throw)", { skip }, async () => {
  assert.equal(await postgresKnowsTimezone(db!, "Asia/Kolkata"), true);
  assert.equal(await postgresKnowsTimezone(db!, "America/New_York"), true);
  assert.equal(await postgresKnowsTimezone(db!, "Mars/Olympus_Mons"), false);
  assert.equal(await postgresKnowsTimezone(db!, "Mars/Olympus_Mons"), false, "negative answers are not cached as true");
  // Cached positives still answer without a round trip.
  assert.equal(await postgresKnowsTimezone(db!, "Asia/Kolkata"), true);
});
