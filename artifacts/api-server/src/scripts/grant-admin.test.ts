import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, getTestDb, resetDb } from "@workspace/db/testing";
import { users } from "@workspace/db";
import { grantAdmin } from "./grant-admin";

const db = getTestDb();
const skip = db ? false : "TEST_DATABASE_URL not set";

after(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  if (db) await resetDb(db);
});

test("grantAdmin promotes by email (case-insensitive); unknown email -> null", { skip }, async () => {
  await db!
    .insert(users)
    .values({ email: "op@x.io", username: "op", passwordHash: "h", birthYear: 1990, termsAcceptedAt: new Date() });
  const granted = await grantAdmin(db!, "  OP@x.io ");
  assert.equal(granted?.role, "admin");
  const [row] = await db!.select().from(users).where(eq(users.email, "op@x.io"));
  assert.equal(row!.role, "admin");
  assert.equal(await grantAdmin(db!, "ghost@x.io"), null);
});
