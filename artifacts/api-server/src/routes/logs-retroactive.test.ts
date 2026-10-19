import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { customDomains, profiles, scoreEvents, userDayState } from "@workspace/db";
import { app, auth, db, score, setup, skip } from "./game-test-helpers";
import { ensureRolledOver } from "../services/rollover";
import { grantEntitlement } from "../services/entitlements";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const H = 3600_000;
const at = (iso: string) => new Date(iso);
let clock = at("2026-03-10T08:00:00Z"); // 13:30 in Asia/Kolkata
const a = () => app({ now: () => clock });
let cid = 0;
const post = (token: string, body: Record<string, unknown>) =>
  request(a()).post("/api/logs").set(auth(token)).send({ clientId: `r${cid++}`, domain: "BODY", logType: "generic", ...body });
const ago = (ms: number) => new Date(clock.getTime() - ms).toISOString();

/**
 * `onboardedDaysAgo` 0 (the default) onboards on the test day with nothing rolled yet. More pins onboarding that many
 * days back with every date before the test day rolled, so a backdated log is not stopped by the onboarding floor.
 */
async function mk(pro: boolean, onboardedDaysAgo = 0) {
  clock = at("2026-03-10T08:00:00Z");
  const { token, id } = await setup(a());
  // Onboarding stamps real time; pin it to the test clock so rollover starts on the first test day.
  const onboardedAt = new Date(clock.getTime() - onboardedDaysAgo * 24 * H);
  await db!.update(profiles).set({ onboardedAt, rankSince: new Date(onboardedAt.getTime() - 30 * 24 * H) }).where(eq(profiles.userId, id));
  await db!
    .update(userDayState)
    .set({ lastRolledDate: onboardedDaysAgo > 0 ? "2026-03-09" : null, nextRolloverAt: new Date(clock.getTime() + 24 * H) })
    .where(eq(userDayState.userId, id));
  if (pro) await grantEntitlement(db!, id, "pro", null, clock);
  return { token, id };
}

test("retroactive window: 47h ok, 49h free 422, 49h PRO ok, 31 days PRO 422", { skip }, async () => {
  const free = await mk(false, 31);
  assert.equal((await post(free.token, { occurredAt: ago(47 * H) })).status, 201);
  const tooOld = await post(free.token, { occurredAt: ago(49 * H) });
  assert.equal(tooOld.status, 422);
  assert.equal(tooOld.body.code, "retroactive_limit");

  await resetDb(db!);
  const pro = await mk(true, 31);
  assert.equal((await post(pro.token, { occurredAt: ago(49 * H) })).status, 201);
  assert.equal((await post(pro.token, { occurredAt: ago(29 * 24 * H) })).status, 201);
  const old = await post(pro.token, { occurredAt: ago(31 * 24 * H) });
  assert.equal(old.status, 422);
  assert.equal(old.body.code, "retroactive_limit");
});

test("an expired PRO is held to the free window", { skip }, async () => {
  const u = await mk(false, 31);
  await grantEntitlement(db!, u.id, "pro", new Date(clock.getTime() - H), clock);
  assert.equal((await post(u.token, { occurredAt: ago(49 * H) })).status, 422);
});

/** Logs on the onboarding day, then moves to 4 days later with every earlier date rolled (streak broken). */
async function lapsed(pro: boolean) {
  const u = await mk(pro);
  const id = u.id;
  assert.equal((await post(u.token, {})).status, 201); // lastLogDate 2026-03-10, streak 1
  clock = at("2026-03-14T08:00:00Z");
  await ensureRolledOver(db!, u.id, clock); // the state route reads the wall clock, so roll with the test clock
  const before = await score(u.id, "BODY");
  assert.equal(before.streak, 0);
  assert.equal(before.lastLogDate, "2026-03-10");
  assert.equal((await db!.select().from(userDayState).where(eq(userDayState.userId, id)))[0]!.lastRolledDate, "2026-03-13");
  return { ...u, before };
}
const lastActivity = async (id: string) =>
  (await db!.select().from(userDayState).where(eq(userDayState.userId, id)))[0]!.lastActivityDate;

test("Review Focus 5: PRO log dated 3 days ago (rolled over) scores but leaves streak, lastLogDate and lastActivityDate", { skip }, async () => {
  const u = await lapsed(true);
  const activityBefore = await lastActivity(u.id);
  const res = await post(u.token, { occurredAt: ago(3 * 24 * H) });
  assert.equal(res.status, 201);
  assert.equal(res.body.log.localDate, "2026-03-11");
  assert.equal(res.body.log.isRetroactive, true);
  assert.equal(res.body.notices.filter((n: { kind: string }) => n.kind === "comeback").length, 0);
  const after2 = await score(u.id, "BODY");
  assert.ok(after2.score > u.before.score, "the domain delta is applied");
  assert.equal(after2.streak, 0);
  assert.equal(after2.lastLogDate, "2026-03-10");
  assert.equal(await lastActivity(u.id), activityBefore);
  const ev = await db!.select().from(scoreEvents).where(and(eq(scoreEvents.userId, u.id), eq(scoreEvents.reason, "log")));
  assert.equal(ev.length, 2);
});

test("a log dated yesterday after rollover does not increment or un-break the streak", { skip }, async () => {
  const u = await lapsed(false);
  const activityBefore = await lastActivity(u.id);
  const res = await post(u.token, { occurredAt: ago(24 * H) });
  assert.equal(res.status, 201);
  assert.equal(res.body.log.localDate, "2026-03-13");
  const after2 = await score(u.id, "BODY");
  assert.ok(after2.score > u.before.score);
  assert.equal(after2.streak, 0);
  assert.equal(after2.lastLogDate, "2026-03-10");
  assert.equal(await lastActivity(u.id), activityBefore);
  assert.equal(res.body.results[0].streak, 0);
});

test("a log dated today still counts as activity", { skip }, async () => {
  const u = await lapsed(false);
  const res = await post(u.token, {});
  assert.equal(res.status, 201);
  const after2 = await score(u.id, "BODY");
  assert.equal(after2.streak, 1);
  assert.equal(after2.lastLogDate, "2026-03-14");
  assert.equal(await lastActivity(u.id), "2026-03-14");
});

test("C1: on the onboarding day a PRO user cannot backfill before onboarding (422 before_onboarding); today still counts", { skip }, async () => {
  const u = await mk(true);
  for (const days of [3, 1, 29]) {
    const res = await post(u.token, { occurredAt: ago(days * 24 * H) });
    assert.equal(res.status, 422, `D-${days}`);
    assert.equal(res.body.code, "before_onboarding");
  }
  const body = await score(u.id, "BODY");
  assert.equal(body.streak, 0, "nothing was backfilled");
  assert.equal((await db!.select().from(scoreEvents).where(and(eq(scoreEvents.userId, u.id), eq(scoreEvents.reason, "log")))).length, 0);
  const today = await post(u.token, {});
  assert.equal(today.status, 201);
  assert.equal((await score(u.id, "BODY")).streak, 1);
});

test("C1: an onboarding-day timezone edge: the floor is the onboarding local date, earlier that same local day is fine", { skip }, async () => {
  const u = await mk(true);
  // 08:00Z is 13:30 in Kolkata; 7 h earlier is 06:30 the same local day.
  const res = await post(u.token, { occurredAt: ago(7 * H) });
  assert.equal(res.status, 201);
  assert.equal(res.body.log.localDate, "2026-03-10");
  assert.equal((await score(u.id, "BODY")).streak, 1);
});

test("C1: a custom-domain log dated before onboarding is 422 before_onboarding", { skip }, async () => {
  const u = await mk(true);
  const created = await request(a()).post("/api/custom-domains").set(auth(u.token)).send({ name: "Piano", baseline: 0, target: 100 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id ?? created.body.domain?.id;
  const res = await request(a())
    .post(`/api/custom-domains/${id}/logs`)
    .set(auth(u.token))
    .send({ clientId: "c-old", value: 1, occurredAt: ago(3 * 24 * H) });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, "before_onboarding");
  const [row] = await db!.select().from(customDomains).where(eq(customDomains.userId, u.id));
  assert.equal(row!.streak, 0);
  assert.equal(
    (await request(a()).post(`/api/custom-domains/${id}/logs`).set(auth(u.token)).send({ clientId: "c-now", value: 1 })).status,
    201,
  );
});

test("M5: client ids with the server-reserved prefixes recurring: and goal: are 400 on both log routes", { skip }, async () => {
  const u = await mk(false);
  for (const clientId of ["recurring:abc:2026-03", "goal:x:y"]) {
    const res = await request(a()).post("/api/logs").set(auth(u.token)).send({ clientId, domain: "WEALTH", logType: "generic" });
    assert.equal(res.status, 400, clientId);
  }
  const created = await request(a()).post("/api/custom-domains").set(auth(u.token)).send({ name: "Piano", baseline: 0, target: 100 });
  const id = created.body.id ?? created.body.domain?.id;
  for (const clientId of ["recurring:abc", "goal:abc"]) {
    const res = await request(a()).post(`/api/custom-domains/${id}/logs`).set(auth(u.token)).send({ clientId, value: 1 });
    assert.equal(res.status, 400, clientId);
  }
  assert.equal((await post(u.token, { clientId: "my-recurring:ok" })).status, 201, "only a leading prefix is reserved");
});
