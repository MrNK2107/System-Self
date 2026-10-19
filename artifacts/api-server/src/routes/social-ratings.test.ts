import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { and, asc, eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import {
  blocks,
  clanMembers,
  clans,
  dailySnapshots,
  notices,
  peerRatingWeeks,
  peerRatings,
  profiles,
  scoreEvents,
  userDayState,
  users,
} from "@workspace/db";
import { addDays, endOfLocalDay } from "@workspace/engine";
import { FORMER_OPERATOR_HANDLE, PeerRatingsMineSchema } from "@workspace/contracts";
import { app, assertContract, assertStoredNoticesMatchContract, auth, db, setup, skip, TZ } from "./game-test-helpers";
import { evaluatePeerRatingsWeek } from "../services/peer-ratings";
import { rolloverDate } from "../services/rollover";
import { withUserLock } from "../services/user-lock";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

// D0 is a Thursday. ISO week 2026-W02 runs Monday 2026-01-05 .. Sunday 2026-01-11 (Asia/Kolkata local dates).
const D0 = "2026-01-01";
const WED = "2026-01-07";
const SUN = "2026-01-11";
const NEXT_WED = "2026-01-14";
const at = (date: string, hhmm = "12:00") => new Date(`${date}T${hhmm}:00+05:30`);
const JOINED = at("2025-12-20"); // well over 7 days before any date used here

let clock = at(WED);
const a = () => app({ now: () => clock });

interface U {
  id: string;
  token: string;
  name: string;
}
let n = 0;
async function mk(name: string): Promise<U> {
  const username = `p_${name}`;
  const { token, id } = await setup(a(), { email: `${name}${n++}@example.com`, username });
  return { id, token, name: username };
}

/** A clan with the given users as members (the first leads); `joinedAt` per user id overrides the default old join. */
async function clanOf(members: U[], joinedAt: Record<string, Date> = {}) {
  const [clan] = await db!
    .insert(clans)
    .values({ name: "Iron Wolves", nameLower: "iron wolves", tag: "IRON", inviteCode: "ABCDEFGH" })
    .returning();
  for (const [i, u] of members.entries()) {
    await db!.insert(clanMembers).values({ userId: u.id, clanId: clan!.id, role: i === 0 ? "leader" : "member", joinedAt: joinedAt[u.id] ?? JOINED });
  }
  return clan!;
}

const rate = (from: U, rateeUserId: unknown, rating: unknown, key?: string) => {
  const r = request(a()).post("/api/clans/ratings").set(auth(from.token));
  if (key) r.set("Idempotency-Key", key);
  return r.send({ rateeUserId, rating });
};
const mine = (u: U) => request(a()).get("/api/clans/ratings/mine").set(auth(u.token));

async function peerEvents(userId: string) {
  return db!
    .select()
    .from(scoreEvents)
    .where(and(eq(scoreEvents.userId, userId), eq(scoreEvents.reason, "peer_rating")))
    .orderBy(asc(scoreEvents.id));
}
const peerNotices = (userId: string) => db!.select().from(notices).where(and(eq(notices.userId, userId), eq(notices.kind, "peer_rating_result")));

/** Pins the ratee's onboarding day to D0 so their rollover starts there (as the finance tests do). */
async function pinToD0(userId: string) {
  await db!.update(profiles).set({ onboardedAt: at(D0, "09:00"), rankSince: at(addDays(D0, -30)) }).where(eq(profiles.userId, userId));
  await db!.update(dailySnapshots).set({ localDate: D0 }).where(eq(dailySnapshots.userId, userId));
  await db!.update(userDayState).set({ nextRolloverAt: endOfLocalDay(D0, TZ), lastRolledDate: addDays(SUN, -1) }).where(eq(userDayState.userId, userId));
}
const roll = (userId: string, date: string) => withUserLock(db!, userId, (tx) => rolloverDate(tx, userId, date, at(addDays(date, 1), "03:00")));

test("rating rules: self, non-clanmate, blocks, tenure and bad values are refused", { skip }, async () => {
  const me = await mk("me");
  const mate = await mk("mate");
  const fresh = await mk("fresh");
  const outsider = await mk("outsider");
  const blockedBy = await mk("blockedby");
  const blockedMe = await mk("blockedme");
  await clanOf([me, mate, fresh, blockedBy, blockedMe], { [fresh.id]: at("2026-01-02") });
  await db!.insert(blocks).values({ blockerId: blockedBy.id, blockedId: me.id });
  await db!.insert(blocks).values({ blockerId: me.id, blockedId: blockedMe.id });

  const self = await rate(me, me.id, 3);
  assert.equal(self.status, 403);
  assert.equal(self.body.code, "self_target");
  for (const ratee of [outsider.id, blockedBy.id, blockedMe.id, fresh.id, "00000000-0000-4000-8000-000000000000"]) {
    const res = await rate(me, ratee, 3);
    assert.equal(res.status, 403, ratee);
    assert.equal(res.body.code, "not_eligible", ratee);
  }
  // Rater tenure: the same rule from the other side.
  const young = await rate(fresh, mate.id, 3);
  assert.equal(young.status, 403);
  assert.equal(young.body.code, "not_eligible");
  // No clan at all.
  const loner = await rate(outsider, mate.id, 3);
  assert.equal(loner.status, 403);
  assert.equal(loner.body.code, "not_eligible");
  for (const bad of [0, 6, 2.5, "4", null]) assert.equal((await rate(me, mate.id, bad)).status, 400, String(bad));
  assert.equal((await rate(me, "not-a-uuid", 3)).status, 400);
  assert.equal((await db!.select().from(peerRatings)).length, 0);

  // Tenure of exactly 7 days is enough.
  await db!.update(clanMembers).set({ joinedAt: new Date(clock.getTime() - 7 * 86_400_000) }).where(eq(clanMembers.userId, fresh.id));
  assert.equal((await rate(me, fresh.id, 3)).status, 200);
});

test("at most 5 distinct clanmates a week; re-rating updates; the week resets", { skip }, async () => {
  const me = await mk("me");
  const others = [await mk("m1"), await mk("m2"), await mk("m3"), await mk("m4"), await mk("m5"), await mk("m6")];
  await clanOf([me, ...others]);

  for (const [i, o] of others.slice(0, 5).entries()) {
    const res = await rate(me, o.id, 1 + (i % 5));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assertContract(PeerRatingsMineSchema, res.body);
    assert.equal(res.body.remaining, 4 - i);
  }
  const sixth = await rate(me, others[5]!.id, 4);
  assert.equal(sixth.status, 409);
  assert.equal(sixth.body.code, "rating_limit");

  // Re-rating a clanmate already rated this week is not a new slot.
  const again = await rate(me, others[0]!.id, 5);
  assert.equal(again.status, 200);
  assert.equal(again.body.remaining, 0);
  assert.equal((await db!.select().from(peerRatings)).length, 5);

  const view = assertContract(PeerRatingsMineSchema, (await mine(me)).body);
  assert.equal(view.weekKey, "2026-W02");
  assert.equal(view.remaining, 0);
  assert.deepEqual(
    [...view.given].sort((x, y) => x.rateeHandle.localeCompare(y.rateeHandle)),
    [
      { rateeHandle: "p_m1", rating: 5 },
      { rateeHandle: "p_m2", rating: 2 },
      { rateeHandle: "p_m3", rating: 3 },
      { rateeHandle: "p_m4", rating: 4 },
      { rateeHandle: "p_m5", rating: 5 },
    ],
  );

  // A new ISO week (the rater's local date) has a fresh allowance.
  clock = at(NEXT_WED);
  const next = assertContract(PeerRatingsMineSchema, (await mine(me)).body);
  assert.deepEqual(next, { weekKey: "2026-W03", given: [], remaining: 5 });
  assert.equal((await rate(me, others[5]!.id, 4)).status, 200);
  clock = at(WED);
});

test("the limit holds under concurrent ratings from one rater", { skip }, async () => {
  const me = await mk("me");
  const others = [await mk("c1"), await mk("c2"), await mk("c3"), await mk("c4"), await mk("c5"), await mk("c6")];
  await clanOf([me, ...others]);
  const results = await Promise.all(others.map((o) => rate(me, o.id, 4)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 200, 200, 409]);
  assert.equal((await db!.select().from(peerRatings)).length, 5);
});

test("a keyed replay returns the stored response without a second write", { skip }, async () => {
  const me = await mk("me");
  const mate = await mk("mate");
  await clanOf([me, mate]);
  const first = await rate(me, mate.id, 4, "k-1");
  const replay = await rate(me, mate.id, 2, "k-1");
  assert.equal(first.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal((await db!.select().from(peerRatings))[0]!.rating, 4);
});

test("GET mine names current clanmates by username and a former clanmate as FORMER OPERATOR", { skip }, async () => {
  const me = await mk("me");
  const stay = await mk("stay");
  const gone = await mk("gone");
  await clanOf([me, stay, gone]);
  await rate(me, stay.id, 4);
  await rate(me, gone.id, 2);
  await db!.delete(clanMembers).where(eq(clanMembers.userId, gone.id));
  const view = assertContract(PeerRatingsMineSchema, (await mine(me)).body);
  assert.deepEqual(
    [...view.given].sort((x, y) => x.rating - y.rating),
    [
      { rateeHandle: FORMER_OPERATOR_HANDLE, rating: 2 },
      { rateeHandle: "p_stay", rating: 4 },
    ],
  );
  assert.equal(view.remaining, 3, "a rating given still uses its slot after the ratee left");
  assert.deepEqual((await mine(stay)).body.given, [], "nobody can read who rated them");
});

test("week close: (average - 3) via peer_rating, once, only with 4 or more ratings, aggregates only in the notice", { skip }, async () => {
  const ratee = await mk("ratee");
  const raters = [await mk("r1"), await mk("r2"), await mk("r3"), await mk("r4")];
  await clanOf([ratee, ...raters]);
  await pinToD0(ratee.id);
  for (const [i, r] of raters.entries()) assert.equal((await rate(r, ratee.id, [5, 4, 5, 4][i]!)).status, 200);

  await roll(ratee.id, SUN);
  const events = await peerEvents(ratee.id);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.domain, "SOCIAL");
  assert.equal(events[0]!.refId, "2026-W02");
  assert.ok(Math.abs(events[0]!.delta - 1.5) < 1e-4, String(events[0]!.delta));

  const [note] = await peerNotices(ratee.id);
  assert.deepEqual(note!.payload, { weekKey: "2026-W02", average: 4.5, delta: 1.5 });
  const [week] = await db!.select().from(peerRatingWeeks).where(eq(peerRatingWeeks.userId, ratee.id));
  assert.equal(week!.ratingCount, 4);
  assert.equal(week!.evaluatedOn, SUN);

  // Exactly once: the same week evaluated again (a re-roll, or a direct second call) changes nothing.
  await db!.update(userDayState).set({ lastRolledDate: addDays(SUN, -1) }).where(eq(userDayState.userId, ratee.id));
  await roll(ratee.id, SUN);
  await withUserLock(db!, ratee.id, (tx) => evaluatePeerRatingsWeek(tx, ratee.id, SUN, at(NEXT_WED)));
  assert.equal((await peerEvents(ratee.id)).length, 1);
  assert.equal((await peerNotices(ratee.id)).length, 1);
  assert.equal((await db!.select().from(peerRatingWeeks)).length, 1);

  // Privacy: nothing the ratee can read names or identifies a rater.
  const seen = JSON.stringify([
    (await request(a()).get("/api/state").set(auth(ratee.token))).body,
    (await request(a()).get("/api/notices").set(auth(ratee.token))).body,
    (await mine(ratee)).body,
    await peerNotices(ratee.id),
    await db!.select().from(peerRatingWeeks),
    await peerEvents(ratee.id),
  ]);
  for (const r of raters) {
    assert.ok(!seen.includes(r.id), `${r.name} id leaked`);
    assert.ok(!seen.includes(`"${r.name}"`), `${r.name} handle leaked`);
  }
});

test("fewer than 4 ratings change nothing; an average of exactly 3 notifies with no score change", { skip }, async () => {
  const two = await mk("two");
  const three = await mk("three");
  const raters = [await mk("r1"), await mk("r2"), await mk("r3"), await mk("r4")];
  await clanOf([two, three, ...raters]);
  await pinToD0(two.id);
  await pinToD0(three.id);
  for (const r of raters.slice(0, 3)) await rate(r, two.id, 5); // three ratings is still below the threshold
  for (const [i, r] of raters.entries()) await rate(r, three.id, [2, 3, 4, 3][i]);

  await roll(two.id, SUN);
  assert.equal((await peerEvents(two.id)).length, 0);
  assert.equal((await peerNotices(two.id)).length, 0);

  await roll(three.id, SUN);
  assert.equal((await peerEvents(three.id)).length, 0);
  const [note] = await peerNotices(three.id);
  assert.deepEqual(note!.payload, { weekKey: "2026-W02", average: 3, delta: 0 });
});

test("only the closing week counts, and a rater who left the clan mid-week still counts", { skip }, async () => {
  const ratee = await mk("ratee");
  const raters = [await mk("r1"), await mk("r2"), await mk("r3"), await mk("r5")];
  const extra = await mk("r4");
  const clan = await clanOf([ratee, ...raters, extra]);
  await pinToD0(ratee.id);
  for (const r of raters) await rate(r, ratee.id, 5);
  // A rating made the following week must not leak into W02.
  clock = at(NEXT_WED);
  await rate(extra, ratee.id, 1);
  clock = at(WED);
  await db!.delete(clanMembers).where(eq(clanMembers.userId, raters[0]!.id)); // leaves before the week closes
  assert.ok(clan.id);

  await roll(ratee.id, SUN);
  const [note] = await peerNotices(ratee.id);
  assert.deepEqual(note!.payload, { weekKey: "2026-W02", average: 5, delta: 2 });
  assert.equal((await db!.select().from(peerRatings).where(eq(peerRatings.rateeId, ratee.id))).length, 5);
});

test("the week key is the rater's own local ISO week", { skip }, async () => {
  const me = await mk("me");
  const mate = await mk("mate");
  await clanOf([me, mate]);
  await db!.update(users).set({ timezone: "America/Los_Angeles" }).where(eq(users.id, me.id));
  clock = new Date("2026-01-12T03:00:00Z"); // Monday 03:00 UTC, still Sunday 2026-01-11 (W02) in Los Angeles
  assert.equal((await rate(me, mate.id, 4)).status, 200);
  assert.equal((await db!.select().from(peerRatings))[0]!.weekKey, "2026-W02");
  clock = at(WED);
});
