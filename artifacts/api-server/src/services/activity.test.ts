import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { comebacks, logs, profiles, quests, userDayState } from "@workspace/db";
import { addDays, localDate } from "@workspace/engine";
import { applyActivityChanges } from "./activity";
import { insertNotice } from "./scoring";
import { withUserLock } from "./user-lock";
import { TZ, app, assertStoredNoticesMatchContract, db, setup, skip } from "../routes/game-test-helpers";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const NOW = new Date("2026-06-08T06:30:00Z");
const TODAY = localDate(NOW, TZ);

/** An onboarded user, onboarded 30 days ago and last active a week ago, everything before today rolled. */
async function returningUser() {
  const { id } = await setup(app({ now: () => NOW }));
  await db!.update(profiles).set({ onboardedAt: new Date(NOW.getTime() - 30 * 86_400_000) }).where(eq(profiles.userId, id));
  await db!
    .update(userDayState)
    .set({ lastActivityDate: addDays(TODAY, -7), lastRolledDate: addDays(TODAY, -1), nextRolloverAt: new Date(NOW.getTime() + 86_400_000) })
    .where(eq(userDayState.userId, id));
  return id;
}

const bodyLog = { domain: "BODY" as const, delta: 2.5, bonus: true, activity: true, reason: "log" as const };

test("applyActivityChanges: comeback first, then applied, then afterApply, then the returner mark", { skip }, async () => {
  const id = await returningUser();
  // Everything else on the checklist is already done today, so this activity completes it.
  const row = (clientId: string, domain: string) => ({ userId: id, clientId, domain, logType: "x", occurredAt: NOW, localDate: TODAY });
  await db!.insert(logs).values([row("a1", "BODY"), row("a2", "MIND")]);
  await db!.insert(quests).values({
    userId: id,
    type: "daily",
    title: "Done",
    description: "d",
    domain: "MIND",
    status: "complete",
    expiresAt: NOW,
    resolvedAt: NOW,
    resolvedLocalDate: TODAY,
  });

  const out = await withUserLock(db!, id, (tx) =>
    applyActivityChanges(tx, id, [bodyLog], { localDate: TODAY, now: NOW }, {
      afterApply: async () => [await insertNotice(tx, id, "chain_complete", { name: "C", templateKey: "k" }, NOW)],
    }),
  );
  const kinds = out.notices.map((n) => n.kind);
  assert.equal(kinds[0], "comeback");
  assert.deepEqual(kinds.slice(-2), ["chain_complete", "returner_mark"]);
  assert.equal(out.results.length, 1);
  assert.equal((await db!.select().from(comebacks)).length, 1);
});

test("applyActivityChanges: no activity change, no comeback", { skip }, async () => {
  const id = await returningUser();
  const penalty = { domain: "DISCIPLINE" as const, delta: -2, bonus: false, activity: false, reason: "quest_refusal" as const };
  const out = await withUserLock(db!, id, (tx) => applyActivityChanges(tx, id, [penalty], { localDate: TODAY, now: NOW }));
  assert.equal(out.notices.some((n) => n.kind === "comeback"), false);
  assert.equal((await db!.select().from(comebacks)).length, 0);
});

test("applyActivityChanges: the gap is judged from activityDate", { skip }, async () => {
  const id = await returningUser();
  // Backdated to yesterday: still 6 empty days since a week ago, so a comeback.
  const out = await withUserLock(db!, id, (tx) =>
    applyActivityChanges(tx, id, [bodyLog], { localDate: addDays(TODAY, -1), now: NOW }, { activityDate: addDays(TODAY, -1) }),
  );
  assert.equal(out.notices[0]?.kind, "comeback");
  assert.equal((await db!.select().from(comebacks))[0]!.startedOn, TODAY);
});
