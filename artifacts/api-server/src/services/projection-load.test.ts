import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeTestDb, getTestDb, resetDb } from "@workspace/db/testing";
import { clanMembers, clans, dailySnapshots, domainScores, profiles, shadowSelves, users } from "@workspace/db";
import { RANKED_DOMAINS, hiddenScore, type RankedDomain } from "@workspace/engine";
import { loadProjectionSubjects } from "./projection";

const db = getTestDb();
const skip = db ? false : "TEST_DATABASE_URL not set";
after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const NOW = new Date("2026-10-19T12:00:00Z");
const RANKS = ["E", "D", "C", "B", "A", "S"];

/** Seeds `n` users: user i has all domain scores 20+i, rank by i, a snapshot 7 days back that makes the trajectory up/down/stable by i mod 3. */
async function seed(n: number) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const [u] = await db!
      .insert(users)
      .values({ email: `u${i}@x.com`, passwordHash: "h", username: `user_${i}`, birthYear: 1990, termsAcceptedAt: new Date() })
      .returning();
    const id = u!.id;
    ids.push(id);
    await db!.insert(profiles).values({
      userId: id,
      primaryGoal: "g",
      biggestWeakness: "BODY",
      codename: "c",
      publicCodename: `USER // SEED-${i}`,
      identitySetting: "public",
      rank: RANKS[i % 6]!,
      onboardingRatings: {},
    });
    const scores = Object.fromEntries(RANKED_DOMAINS.map((d) => [d, 20 + i])) as Record<RankedDomain, number>;
    await db!.insert(domainScores).values(RANKED_DOMAINS.map((d) => ({ userId: id, domain: d, score: scores[d] })));
    const offset = i % 3 === 0 ? -5 : i % 3 === 1 ? 5 : 0; // reference minus current: up, down, stable
    await db!.insert(dailySnapshots).values({
      userId: id,
      localDate: "2026-10-12",
      scores,
      hidden: hiddenScore(scores, 1) + offset,
      rank: "E",
    });
    if (i % 4 === 0) await db!.insert(shadowSelves).values({ userId: id, active: true, codename: "s", initialScores: scores, gainRates: scores });
  }
  return ids;
}

test("loadProjectionSubjects: 50 subjects come back with the right rank, scores, trajectory and shadow", { skip }, async () => {
  const ids = await seed(50);
  const got = await loadProjectionSubjects(db!, ids, NOW);
  assert.equal(got.size, 50);
  ids.forEach((id, i) => {
    const s = got.get(id)!;
    assert.equal(s.username, `user_${i}`);
    assert.equal(s.rank, RANKS[i % 6]);
    assert.equal(s.publicCodename, `USER // SEED-${i}`);
    for (const d of RANKED_DOMAINS) assert.equal(s.scores[d], 20 + i);
    assert.equal(s.trajectory, i % 3 === 0 ? "up" : i % 3 === 1 ? "down" : "stable", `trajectory of ${i}`);
    assert.equal(s.shadowActive, i % 4 === 0, `shadow of ${i}`);
  });
});

test("loadProjectionSubjects: the number of queries does not depend on the number of subjects", { skip }, async () => {
  const ids = await seed(50);
  const count = async (subset: string[]) => {
    let n = 0;
    const counting = { select: (...a: unknown[]) => (n++, (db!.select as (...x: unknown[]) => unknown)(...a)) } as unknown as typeof db & object;
    await loadProjectionSubjects(counting as never, subset, NOW);
    return n;
  };
  const few = await count(ids.slice(0, 2));
  const many = await count(ids);
  assert.equal(many, few);
  assert.ok(many <= 7, `expected a handful of queries, got ${many}`);
});

test("loadProjectionSubjects: carries the clan tag of clan members only", { skip }, async () => {
  const ids = await seed(3);
  const [clan] = await db!.insert(clans).values({ name: "Iron Wolves", nameLower: "iron wolves", tag: "IRON", inviteCode: "CODE1234" }).returning();
  await db!.insert(clanMembers).values({ userId: ids[0]!, clanId: clan!.id, role: "leader" });
  const got = await loadProjectionSubjects(db!, ids, NOW);
  assert.equal(got.get(ids[0]!)!.clanTag, "IRON");
  assert.equal(got.get(ids[1]!)!.clanTag, undefined);
});
