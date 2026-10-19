import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import {
  clanMembers,
  clans,
  customDomains,
  customLogs,
  domainScores,
  idempotencyKeys,
  notices,
  profiles,
  scoreEvents,
  userDayState,
} from "@workspace/db";
import {
  CustomDomainDetailSchema,
  CustomDomainListSchema,
  CustomLogResponseSchema,
  ProRequiredSchema,
  SocialProfileResponseSchema,
} from "@workspace/contracts";
import { RANKED_DOMAINS, type RankedDomain } from "@workspace/engine";
import { app, assertContract, auth, db, setup, skip } from "./game-test-helpers";
import { grantEntitlement } from "../services/entitlements";
import { hiddenAndTrajectory } from "../services/state";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const at = (iso: string) => new Date(iso);
let clock = at("2026-03-10T08:00:00Z"); // 13:30 in Asia/Kolkata
const a = () => app({ now: () => clock });

let n = 0;
async function mk(name = "cu") {
  const username = `u_${name}${n++}`;
  const { token, id } = await setup(a(), { email: `${username}@example.com`, username });
  return { token, id, name: username };
}
type U = Awaited<ReturnType<typeof mk>>;

const create = (u: U, body: Record<string, unknown>) =>
  request(a()).post("/api/custom-domains").set(auth(u.token)).send({ baseline: 0, target: 100, ...body });
const list = (u: U) => request(a()).get("/api/custom-domains").set(auth(u.token));
const detail = (u: U, id: string) => request(a()).get(`/api/custom-domains/${id}`).set(auth(u.token));
const patch = (u: U, id: string, body: Record<string, unknown>) =>
  request(a()).patch(`/api/custom-domains/${id}`).set(auth(u.token)).send(body);
const archive = (u: U, id: string) => request(a()).delete(`/api/custom-domains/${id}`).set(auth(u.token));
let cid = 0;
const logTo = (u: U, id: string, body: Record<string, unknown> = {}) =>
  request(a())
    .post(`/api/custom-domains/${id}/logs`)
    .set(auth(u.token))
    .send({ clientId: `log-${cid++}`, value: 10, ...body });
async function scoreMap(userId: string) {
  const rows = await db!.select().from(domainScores).where(eq(domainScores.userId, userId));
  return Object.fromEntries(RANKED_DOMAINS.map((d) => [d, rows.find((r) => r.domain === d)?.score ?? 0])) as Record<RankedDomain, number>;
}
const pro = (u: U) => grantEntitlement(db!, u.id, "pro", null, clock);

test("create and list: defaults, contract shape, oldest first, limit and isPro on the list", { skip }, async () => {
  const u = await mk();
  const res = await create(u, { name: "  Language ", unit: "min", logLabel: "Study", isPublic: true, baseline: 5, target: 60 });
  assert.equal(res.status, 201);
  const made = assertContract(CustomDomainDetailSchema, res.body);
  assert.deepEqual(made.domain, {
    id: made.domain.id,
    name: "Language",
    unit: "min",
    logLabel: "Study",
    baseline: 5,
    target: 60,
    isPublic: true,
    archived: false,
    score: 50,
    streak: 0,
    lastLogDate: null,
    latestValue: null,
  });
  assert.deepEqual(made.logs, []);
  const plain = await create(u, { name: "Cold" });
  assert.equal(plain.body.domain.unit, "");
  assert.equal(plain.body.domain.logLabel, "Log");
  assert.equal(plain.body.domain.isPublic, false);

  const l = assertContract(CustomDomainListSchema, (await list(u)).body);
  assert.deepEqual(l.items.map((d) => d.name), ["Language", "Cold"]);
  assert.equal(l.limit, 3);
  assert.equal(l.isPro, false);
});

test("validation: name 1-24, unit <= 12, logLabel <= 40, numbers finite, unique per user case-insensitively", { skip }, async () => {
  const u = await mk();
  assert.equal((await create(u, { name: "" })).status, 400);
  assert.equal((await create(u, { name: "   " })).status, 400);
  assert.equal((await create(u, { name: "x".repeat(25) })).status, 400);
  assert.equal((await create(u, { name: "x".repeat(24) })).status, 201);
  assert.equal((await create(u, { name: "A", unit: "u".repeat(13) })).status, 400);
  assert.equal((await create(u, { name: "A", logLabel: "l".repeat(41) })).status, 400);
  assert.equal((await create(u, { name: "A", baseline: "zero" })).status, 400);
  assert.equal((await create(u, { name: "A", target: null })).status, 400);
  assert.equal((await create(u, { name: "A", isPublic: "yes" })).status, 400);
  const first = await create(u, { name: "Reading" });
  assert.equal(first.status, 201);
  const dup = await create(u, { name: "reading" });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "name_taken");
  // Another user may use the same name; an archived name is free again.
  const other = await mk("other");
  assert.equal((await create(other, { name: "Reading" })).status, 201);
  assert.equal((await archive(u, first.body.domain.id)).status, 200);
  assert.equal((await create(u, { name: "READING" })).status, 201);
});

test("limits: free 3 active then 402 pro_required; archiving frees a slot; PRO 20 then 409 custom_limit", { skip }, async () => {
  const u = await mk();
  const ids: string[] = [];
  for (const name of ["One", "Two", "Three"]) {
    const r = await create(u, { name });
    assert.equal(r.status, 201);
    ids.push(r.body.domain.id);
  }
  const fourth = await create(u, { name: "Four" });
  assert.equal(fourth.status, 402);
  assertContract(ProRequiredSchema, fourth.body);
  assert.equal((await db!.select().from(customDomains)).length, 3);

  assert.equal((await archive(u, ids[0]!)).status, 200);
  assert.equal((await create(u, { name: "Four" })).status, 201, "an archived domain does not count");
  assert.equal((await create(u, { name: "Five" })).status, 402);

  await pro(u);
  assert.equal((await list(u)).body.limit, 20);
  for (let i = 5; i <= 21; i++) assert.equal((await create(u, { name: `D${i}` })).status, 201, `D${i}`);
  const over = await create(u, { name: "D22" });
  assert.equal(over.status, 409);
  assert.equal(over.body.code, "custom_limit");
  assert.equal((await list(u)).body.items.length, 20);
});

test("an expired PRO is free again for creating, and the domains it made keep working", { skip }, async () => {
  const u = await mk();
  await grantEntitlement(db!, u.id, "pro", new Date(clock.getTime() + 3600_000), clock);
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push((await create(u, { name: `P${i}` })).body.domain.id);
  clock = new Date(clock.getTime() + 2 * 3600_000);
  assert.equal((await create(u, { name: "late" })).status, 402);
  assert.equal((await logTo(u, ids[4]!, { clientId: "late-1" })).status, 201);
  clock = at("2026-03-10T08:00:00Z");
});

test("PATCH edits fields, keeps the unique name rule, refuses an archived or foreign domain; DELETE archives and keeps history", { skip }, async () => {
  const u = await mk();
  const other = await mk("other");
  const d = (await create(u, { name: "Run", unit: "km" })).body.domain;
  const e = (await create(u, { name: "Swim" })).body.domain;
  assert.equal((await logTo(u, d.id, { value: 3 })).status, 201);

  const edited = await patch(u, d.id, { name: "Running", target: 42, isPublic: true });
  assert.equal(edited.status, 200);
  assertContract(CustomDomainDetailSchema, edited.body);
  assert.equal(edited.body.domain.name, "Running");
  assert.equal(edited.body.domain.target, 42);
  assert.equal(edited.body.domain.unit, "km", "untouched fields stay");
  assert.equal(edited.body.domain.score, 52.5, "editing never moves the score");

  assert.equal((await patch(u, d.id, {})).status, 400);
  assert.equal((await patch(u, d.id, { name: "swim" })).status, 409);
  assert.equal((await patch(u, d.id, { name: "RUNNING" })).status, 200, "renaming to its own name in another case is allowed");
  assert.equal((await patch(other, d.id, { name: "Mine" })).status, 404);
  assert.equal((await patch(u, "not-a-uuid", { name: "x" })).status, 404);

  const gone = await archive(u, d.id);
  assert.equal(gone.status, 200);
  assert.equal(gone.body.domain.name, "RUNNING");
  assert.equal(gone.body.domain.archived, true);
  assert.equal((await archive(other, e.id)).status, 404);
  assert.deepEqual((await list(u)).body.items.map((x: { name: string }) => x.name), ["Swim"]);
  assert.equal((await patch(u, d.id, { name: "Back" })).status, 409);
  assert.equal((await db!.select().from(customLogs).where(eq(customLogs.customDomainId, d.id))).length, 1, "history is kept");
  const view = await detail(u, d.id);
  assert.equal(view.status, 200, "an archived domain can still be read");
  assert.equal(view.body.logs.length, 1);
  assert.equal((await detail(other, d.id)).status, 404);
  assert.equal((await archive(u, d.id)).status, 200, "archiving twice is harmless");
});

test("a custom log is +2.5 with the domain's own streak multiplier and answers { score, streak }", { skip }, async () => {
  const u = await mk();
  const d = (await create(u, { name: "Meditate", unit: "min" })).body.domain;

  const first = await logTo(u, d.id, { value: 10, note: "  calm " });
  assert.equal(first.status, 201);
  assert.deepEqual(assertContract(CustomLogResponseSchema, first.body), { score: 52.5, streak: 1 });

  clock = at("2026-03-11T08:00:00Z");
  const second = await logTo(u, d.id, { value: 20 });
  assert.deepEqual(second.body, { score: 55.3, streak: 2 }); // 2.5 x 1.1 = 2.75, rounded to 2.8
  clock = at("2026-03-11T09:00:00Z");
  const sameDay = await logTo(u, d.id, { value: 30 });
  assert.deepEqual(sameDay.body, { score: 58.3, streak: 2 }); // x 1.2 = 3.0, the streak does not advance twice a day

  clock = at("2026-03-14T08:00:00Z"); // two days skipped
  assert.deepEqual((await logTo(u, d.id, { value: 5 })).body, { score: 61.3, streak: 1 }); // the bonus uses the streak before the reset (2): +3.0

  const view = assertContract(CustomDomainDetailSchema, (await detail(u, d.id)).body);
  assert.equal(view.domain.score, 61.3);
  assert.equal(view.domain.streak, 1);
  assert.equal(view.domain.latestValue, 5);
  assert.equal(view.domain.lastLogDate, "2026-03-14");
  assert.deepEqual(view.logs.map((l) => l.value), [5, 30, 20, 10], "newest first");
  assert.equal(view.logs[3]!.note, "calm");
  assert.equal(view.logs[3]!.localDate, "2026-03-10");

  clock = at("2026-03-18T08:00:00Z"); // a lapsed streak reads 0 until the next log
  assert.equal((await detail(u, d.id)).body.domain.streak, 0);
  clock = at("2026-03-10T08:00:00Z");
});

test("custom logs follow the PRO-aware retroactive window", { skip }, async () => {
  const free = await mk("rfree");
  const pro = await mk("rpro");
  await grantEntitlement(db!, pro.id, "pro", null, clock);
  const df = (await create(free, { name: "Words" })).body.domain;
  const dp = (await create(pro, { name: "Words" })).body.domain;
  const ago = (ms: number) => new Date(clock.getTime() - ms).toISOString();
  assert.equal((await logTo(free, df.id, { occurredAt: ago(47 * 3600_000) })).status, 201);
  assert.equal((await logTo(free, df.id, { occurredAt: ago(49 * 3600_000) })).status, 422);
  assert.equal((await logTo(pro, dp.id, { occurredAt: ago(49 * 3600_000) })).status, 201);
  const old = await logTo(pro, dp.id, { occurredAt: ago(31 * 24 * 3600_000) });
  assert.equal(old.status, 422);
  assert.equal(old.body.code, "retroactive_limit");
});

test("a PRO backfill inside a lapsed custom streak scores but repairs nothing", { skip }, async () => {
  const u = await mk("backfill");
  await grantEntitlement(db!, u.id, "pro", null, at("2026-03-10T08:00:00Z"));
  const d = (await create(u, { name: "Words" })).body.domain;
  assert.equal((await logTo(u, d.id)).status, 201); // 2026-03-10: streak 1, score 52.5
  clock = at("2026-03-18T08:00:00Z");
  const back = await logTo(u, d.id, { occurredAt: "2026-03-14T08:00:00Z" });
  assert.equal(back.status, 201);
  assert.equal(back.body.streak, 0, "a lapsed streak still reads 0");
  const [row] = await db!.select().from(customDomains).where(eq(customDomains.id, d.id));
  assert.ok(row!.score > 52.5, "the delta is applied");
  assert.equal(row!.streak, 1, "the stored streak is untouched");
  assert.equal(row!.lastLogDate, "2026-03-10", "lastLogDate does not move");
  const today = await logTo(u, d.id);
  assert.equal(today.body.streak, 1, "the next today-log starts at 1");
  clock = at("2026-03-10T08:00:00Z");
});

test("custom log rules: validation, 48h retroactive limit, future, archived, ownership", { skip }, async () => {
  const u = await mk();
  const other = await mk("other");
  const d = (await create(u, { name: "Words" })).body.domain;

  assert.equal((await logTo(u, d.id, { value: "ten" })).status, 400);
  assert.equal((await logTo(u, d.id, { value: null })).status, 400);
  assert.equal((await logTo(u, d.id, { clientId: "" })).status, 400);
  assert.equal((await logTo(u, d.id, { note: "n".repeat(201) })).status, 400);
  assert.equal((await logTo(u, d.id, { occurredAt: "yesterday" })).status, 400);

  const old = await logTo(u, d.id, { occurredAt: new Date(clock.getTime() - 49 * 3600_000).toISOString() });
  assert.equal(old.status, 422);
  assert.equal(old.body.code, "retroactive_limit");
  const edge = await logTo(u, d.id, { occurredAt: new Date(clock.getTime() - 47 * 3600_000).toISOString() });
  assert.equal(edge.status, 201);
  const future = await logTo(u, d.id, { occurredAt: new Date(clock.getTime() + 3600_000).toISOString() });
  assert.equal(future.status, 422);
  assert.equal(future.body.code, "future_occurred_at");

  assert.equal((await logTo(other, d.id)).status, 404, "another user's domain");
  const foreignOld = await logTo(other, d.id, { occurredAt: new Date(clock.getTime() - 49 * 3600_000).toISOString() });
  assert.equal(foreignOld.status, 404, "ownership is checked before the retroactive window");
  assert.equal((await logTo(u, "00000000-0000-4000-8000-000000000000")).status, 404);
  assert.equal((await logTo(u, "nope")).status, 404);

  await archive(u, d.id);
  const arch = await logTo(u, d.id);
  assert.equal(arch.status, 409);
  assert.equal(arch.body.code, "archived");
  assert.equal((await db!.select().from(customLogs)).length, 1, "only the one accepted log was stored");
});

test("large values keep their precision (double precision columns)", { skip }, async () => {
  const u = await mk();
  const d = (await create(u, { name: "Big", baseline: 16777217, target: 123456789 })).body.domain;
  assert.equal(d.baseline, 16777217);
  assert.equal(d.target, 123456789);
  assert.equal((await logTo(u, d.id, { value: 100000001 })).status, 201);
  assert.equal((await detail(u, d.id)).body.logs[0].value, 100000001);
});

test("a retroactive custom log scores on its own date and never moves the streak backwards", { skip }, async () => {
  const u = await mk();
  const d = (await create(u, { name: "Pages" })).body.domain;
  assert.deepEqual((await logTo(u, d.id)).body, { score: 52.5, streak: 1 });
  const retro = await logTo(u, d.id, { occurredAt: new Date(clock.getTime() - 30 * 3600_000).toISOString() });
  assert.equal(retro.status, 201);
  assert.equal(retro.body.streak, 1, "the earlier date does not extend or reset the streak");
  assert.equal(retro.body.score, 55.3);
  const [row] = await db!.select().from(customDomains).where(eq(customDomains.id, d.id));
  assert.equal(row!.lastLogDate, "2026-03-10");
});

test("custom logs are idempotent by (user, clientId): a replay and a pruned-key retry both apply once", { skip }, async () => {
  const u = await mk();
  const d = (await create(u, { name: "Sketch" })).body.domain;
  const body = { clientId: "same-1", value: 7 };
  const one = await logTo(u, d.id, body);
  assert.equal(one.status, 201);
  const replay = await logTo(u, d.id, body);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, one.body);

  // The idempotency record is pruned: the retry finds the stored custom log and does not apply again.
  await db!.delete(idempotencyKeys).where(and(eq(idempotencyKeys.userId, u.id), eq(idempotencyKeys.key, "same-1")));
  const again = await logTo(u, d.id, body);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { score: 52.5, streak: 1 });
  assert.equal((await db!.select().from(customLogs)).length, 1);
  const [row] = await db!.select().from(customDomains).where(eq(customDomains.id, d.id));
  assert.equal(row!.score, 52.5);

  // Concurrent duplicates of one clientId apply once.
  const par = await Promise.all([1, 2, 3].map(() => logTo(u, d.id, { clientId: "par-1", value: 1 })));
  assert.ok(par.every((r) => r.status === 201 || r.status === 200));
  assert.equal((await db!.select().from(customLogs)).length, 2);
});

test("isolation: custom logs change no ranked score, score event, rank, hidden score, activity day or notice", { skip }, async () => {
  const u = await mk();
  const d = (await create(u, { name: "Isolated", isPublic: true })).body.domain;
  const ranked = async () => ({
    scores: await db!.select().from(domainScores).where(eq(domainScores.userId, u.id)).orderBy(domainScores.domain),
    events: await db!.select().from(scoreEvents).where(eq(scoreEvents.userId, u.id)),
    day: (await db!.select().from(userDayState).where(eq(userDayState.userId, u.id)))[0],
    rank: (await db!.select({ rank: profiles.rank, since: profiles.rankSince }).from(profiles).where(eq(profiles.userId, u.id)))[0],
    notices: await db!.select().from(notices).where(eq(notices.userId, u.id)),
    state: (await request(a()).get("/api/state").set(auth(u.token))).body,
    hidden: (await hiddenAndTrajectory(db!, u.id, "2026-03-10", await scoreMap(u.id))).hidden,
  });
  const before = await ranked();
  for (let i = 0; i < 4; i++) {
    clock = at(`2026-03-${10 + i}T08:00:00Z`);
    assert.equal((await logTo(u, d.id)).status, 201);
  }
  clock = at("2026-03-10T08:00:00Z");
  const after = await ranked();
  assert.deepEqual(after.scores, before.scores, "ranked domain scores");
  assert.deepEqual(after.events, before.events, "no score_events at all");
  assert.deepEqual(after.day, before.day, "lastActivityDate, rollover and comeback state");
  assert.deepEqual(after.rank, before.rank);
  assert.deepEqual(after.notices, before.notices);
  assert.equal(after.hidden, before.hidden, "hidden score inputs");
  assert.deepEqual(after.state, before.state, "the game state is untouched");
});

test("a custom domain shows to a follower as name + score only, and only while public and active", { skip }, async () => {
  const subject = await mk("subject");
  const viewer = await mk("viewer");
  await db!.update(profiles).set({ identitySetting: "public" }).where(eq(profiles.userId, subject.id));
  const pub = (await create(subject, { name: "Cold Plunge", unit: "sec", isPublic: true })).body.domain;
  const priv = (await create(subject, { name: "Secret Habit" })).body.domain;
  const arch = (await create(subject, { name: "Old One", isPublic: true })).body.domain;
  await logTo(subject, pub.id, { value: 90, note: "private note" });
  await logTo(subject, priv.id, { value: 1 });
  await archive(subject, arch.id);

  const follow = await request(a()).post(`/api/social/follow/${subject.name}`).set(auth(viewer.token)).send({});
  assert.ok(follow.status < 300, String(follow.status));
  const res = await request(a()).get(`/api/social/profile/${subject.name}`).set(auth(viewer.token));
  assert.equal(res.status, 200);
  const profile = assertContract(SocialProfileResponseSchema, res.body).profile;
  assert.deepEqual(profile.customDomains, [{ name: "Cold Plunge", score: 52.5 }]);
  const text = JSON.stringify(res.body);
  for (const secret of ["Secret Habit", "Old One", "private note", "sec", pub.id]) {
    assert.ok(!text.includes(secret), `${secret} leaked`);
  }
  assert.deepEqual(Object.keys(profile.customDomains![0]!).sort(), ["name", "score"]);

  // A stranger who does not follow gets no custom domains.
  const stranger = await mk("stranger");
  const seen = await request(a()).get(`/api/social/profile/${subject.name}`).set(auth(stranger.token));
  assert.equal(seen.status, 200);
  assert.equal(seen.body.profile.customDomains, undefined);

  const following = await request(a()).get("/api/social/following").set(auth(viewer.token));
  assert.deepEqual(following.body[0].customDomains, [{ name: "Cold Plunge", score: 52.5 }]);
});

test("a clanmate sees public custom domains in the clan roster; a private one stays private", { skip }, async () => {
  const lead = await mk("lead");
  const mate = await mk("mate");
  const [clan] = await db!.insert(clans).values({ name: "Iron Wolves", nameLower: "iron wolves", tag: "IRON", inviteCode: "ABCDEFGH" }).returning();
  const joinedAt = at("2026-01-01T00:00:00Z");
  await db!.insert(clanMembers).values({ userId: lead.id, clanId: clan!.id, role: "leader", joinedAt });
  await db!.insert(clanMembers).values({ userId: mate.id, clanId: clan!.id, role: "member", joinedAt });
  const pub = (await create(mate, { name: "Chess", isPublic: true })).body.domain;
  await create(mate, { name: "Hidden" });
  await logTo(mate, pub.id);
  const res = await request(a()).get("/api/clans/mine").set(auth(lead.token));
  assert.equal(res.status, 200);
  const roster = JSON.stringify(res.body);
  assert.ok(roster.includes('"customDomains":[{"name":"Chess","score":52.5}]'), roster);
  assert.ok(!roster.includes("Hidden"));
});
