import test, { after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { places, questProofs, quests, sessionSpots } from "@workspace/db";
import { PlacesNearbyResponseSchema, SavePlaceResponseSchema, SessionProofResponseSchema } from "@workspace/contracts";
import { createQuests } from "../services/quests";
import { parseOverpass } from "../services/places";
import { app, auth, db, score, setup, skip, assertContract, assertStoredNoticesMatchContract } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
afterEach(async () => {
  await assertStoredNoticesMatchContract();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const GYM = { lat: 12.9716, lng: 77.5946 };

async function mkQuest(userId: string, title: string, over: { domain?: string; type?: "daily" | "weekly" | "arc" } = {}) {
  const [q] = await createQuests(db!, userId, [
    { type: over.type ?? "daily", title, description: title, domain: over.domain ?? "BODY", expiresAt: new Date(Date.now() + 3600_000) },
  ]);
  return q!;
}

/** A 45-minute workout summary ending now. */
const summary = (over: Record<string, unknown> = {}) => ({
  kind: "workout",
  startedAt: new Date(Date.now() - 45 * 60_000).toISOString(),
  endedAt: new Date().toISOString(),
  activeMinutes: 0,
  steps: 0,
  placeId: null,
  placeShare: 0,
  mocked: false,
  coarse: null,
  ...over,
});

test("a moving 45-minute session proves a 30-minute workout and completes the quest", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id, "Train for 30 minutes");
  await mkQuest(id, "Read", { domain: "MIND" }); // keeps the day from being clean
  const res = await request(a)
    .post(`/api/quests/${q.id}/session`)
    .set(auth(token))
    .send({ clientId: "s1", summary: summary({ activeMinutes: 32, steps: 3120 }) });
  assert.equal(res.status, 200);
  assertContract(SessionProofResponseSchema, res.body);
  assert.equal(res.body.proof.status, "accepted");
  assert.equal(res.body.completed, true);
  assert.equal(res.body.quest.status, "complete");
  assert.deepEqual(res.body.proof.evidence, ["32 active min", "45 min total", "3,120 steps"]);
  // BODY 3.5 * headroom(20)=0.669 = 2.3
  assert.deepEqual(res.body.results[0], { ...res.body.results[0], domain: "BODY", actualDelta: 2.3 });
  assert.equal((await score(id, "BODY")).score, 22.3);
});

test("a still phone away from any gym is rejected with the reason, the proof is kept, the quest stays open", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id, "Train for 30 minutes");
  const res = await request(a).post(`/api/quests/${q.id}/session`).set(auth(token)).send({ summary: summary({ activeMinutes: 4 }) });
  assert.equal(res.status, 200);
  assert.equal(res.body.proof.status, "rejected");
  assert.equal(res.body.completed, false);
  assert.match(res.body.proof.reason, /save this place as your gym/);
  const [row] = await db!.select().from(quests).where(eq(quests.id, q.id));
  assert.equal(row!.status, "active");
  const proofs = await db!.select().from(questProofs).where(eq(questProofs.questId, q.id));
  assert.equal(proofs.length, 1);
  assert.equal((await score(id, "BODY")).score, 20, "no score for a rejected session");
});

test("phone in a locker: most of the session at the user's saved gym proves the workout", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const saved = await request(a).post("/api/places").set(auth(token)).send({ kind: "gym", name: "Iron Den", ...GYM });
  assert.equal(saved.status, 201);
  assertContract(SavePlaceResponseSchema, saved.body);
  const q = await mkQuest(id, "Train for 30 minutes");
  const res = await request(a)
    .post(`/api/quests/${q.id}/session`)
    .set(auth(token))
    .send({ summary: summary({ activeMinutes: 2, placeId: saved.body.place.id, placeShare: 0.9 }) });
  assert.equal(res.body.proof.status, "accepted");
  assert.ok(res.body.proof.evidence.includes("at Iron Den"));
});

test("another user's saved place is not usable as proof", { skip }, async () => {
  const a = app();
  const owner = await setup(a, { email: "owner@example.com", username: "owner_1" });
  const saved = await request(a).post("/api/places").set(auth(owner.token)).send({ kind: "gym", name: "Home", ...GYM });
  const other = await setup(a, { email: "other@example.com", username: "other_1" });
  const q = await mkQuest(other.id, "Train for 30 minutes");
  const res = await request(a)
    .post(`/api/quests/${q.id}/session`)
    .set(auth(other.token))
    .send({ summary: summary({ activeMinutes: 2, placeId: saved.body.place.id, placeShare: 1 }) });
  assert.equal(res.body.proof.status, "rejected");
  const near = await request(a).get(`/api/places/nearby?lat=${GYM.lat}&lng=${GYM.lng}`).set(auth(other.token));
  assertContract(PlacesNearbyResponseSchema, near.body);
  assert.equal(near.body.places.length, 0, "others' saved places are private");
});

test("a mocked location is rejected even with movement", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id, "Train for 30 minutes");
  const res = await request(a).post(`/api/quests/${q.id}/session`).set(auth(token)).send({ summary: summary({ activeMinutes: 40, mocked: true }) });
  assert.equal(res.body.proof.status, "rejected");
  assert.match(res.body.proof.reason, /faked/);
});

test("a weekly 'four sessions' quest counts accepted sessions and completes on the fourth", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id, "Four training sessions", { type: "weekly" });
  for (let i = 1; i <= 4; i++) {
    const res = await request(a)
      .post(`/api/quests/${q.id}/session`)
      .set(auth(token))
      .send({ clientId: `w${i}`, summary: summary({ activeMinutes: 35 }) });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.progress, { done: i, needed: 4 });
    assert.equal(res.body.completed, i === 4);
  }
});

test("a study or social quest is not proven by a workout session; bad summaries are 400", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id, "Call one person", { domain: "SOCIAL" });
  const res = await request(a).post(`/api/quests/${q.id}/session`).set(auth(token)).send({ summary: summary({ activeMinutes: 40 }) });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "not_session_quest");
  const bad = await request(a).post(`/api/quests/${q.id}/session`).set(auth(token)).send({ summary: { kind: "workout" } });
  assert.equal(bad.status, 400);
});

test("three different users proving workouts at one spot teach the map a learned gym", { skip }, async () => {
  const a = app();
  for (const n of [1, 2, 3]) {
    const u = await setup(a, { email: `u${n}@example.com`, username: `user_${n}` });
    const q = await mkQuest(u.id, "Train for 30 minutes");
    const res = await request(a)
      .post(`/api/quests/${q.id}/session`)
      .set(auth(u.token))
      .send({ summary: summary({ activeMinutes: 40, coarse: { lat: 12.972, lng: 77.595 } }) });
    assert.equal(res.body.proof.status, "accepted");
  }
  assert.equal((await db!.select().from(sessionSpots)).length, 3);
  const learned = (await db!.select().from(places)).filter((p) => p.source === "learned");
  assert.equal(learned.length, 1);
  assert.equal(learned[0]!.kind, "gym");
});

test("saved places: limit of 10, delete only your own", { skip }, async () => {
  const a = app();
  const { token } = await setup(a);
  let last = "";
  for (let i = 0; i < 10; i++) {
    const r = await request(a).post("/api/places").set(auth(token)).send({ kind: "study", name: `P${i}`, lat: 10 + i * 0.1, lng: 76 });
    assert.equal(r.status, 201);
    last = r.body.place.id;
  }
  const over = await request(a).post("/api/places").set(auth(token)).send({ kind: "study", name: "P10", lat: 11.5, lng: 76 });
  assert.equal(over.status, 409);
  assert.equal(over.body.code, "place_limit");
  const other = await setup(a, { email: "x@example.com", username: "x_user" });
  assert.equal((await request(a).delete(`/api/places/${last}`).set(auth(other.token))).status, 404);
  assert.equal((await request(a).delete(`/api/places/${last}`).set(auth(token))).status, 204);
});

test("parseOverpass maps gyms, grounds and libraries, skipping elements without a position or kind", () => {
  const parsed = parseOverpass({
    elements: [
      { type: "node", id: 1, lat: 12.97, lon: 77.59, tags: { leisure: "fitness_centre", name: "Iron Den" } },
      { type: "way", id: 2, center: { lat: 12.98, lon: 77.6 }, tags: { leisure: "pitch" } },
      { type: "node", id: 3, lat: 12.99, lon: 77.61, tags: { amenity: "library" } },
      { type: "node", id: 4, lat: 12.99, lon: 77.61, tags: { amenity: "cafe" } },
      { type: "way", id: 5, tags: { leisure: "stadium" } },
    ],
  });
  assert.deepEqual(
    parsed.map((p) => [p.osmId, p.kind, p.radiusM, p.name]),
    [
      ["node/1", "gym", 80, "Iron Den"],
      ["way/2", "sports", 120, null],
      ["node/3", "study", 60, null],
    ],
  );
  assert.deepEqual(parseOverpass(null), []);
});

/** A study summary of `minutes` ending now, on `topic`. */
const study = (minutes: number, topic: string) => ({
  kind: "study",
  startedAt: new Date(Date.now() - minutes * 60_000).toISOString(),
  endedAt: new Date().toISOString(),
  activeMinutes: 0,
  steps: 0,
  placeId: null,
  placeShare: 0,
  mocked: false,
  topic,
});

test("study: a long-enough session gets a bank quiz (AI off); 3 of 5 right completes the quest", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id, "Study physics for 45 minutes", { domain: "MIND" });
  await mkQuest(id, "Call one person", { domain: "SOCIAL" }); // keeps the day from being clean
  const res = await request(a).post(`/api/quests/${q.id}/session`).set(auth(token)).send({ summary: study(50, "Thermodynamics and entropy") });
  assert.equal(res.status, 200);
  assertContract(SessionProofResponseSchema, res.body);
  assert.equal(res.body.proof.status, "awaiting_quiz");
  assert.equal(res.body.completed, false);
  assert.equal(res.body.quiz.source, "bank");
  assert.equal(res.body.quiz.questions.length, 5);
  assert.ok(res.body.quiz.questions.every((x: { options?: string[] }) => x.options && !("answerIndex" in x)), "no answers sent");
  // Read the key from the stored proof and answer 3 right, 2 wrong.
  const [stored] = await db!.select().from(questProofs).where(eq(questProofs.id, res.body.quiz.proofId));
  const keys = (stored!.summary as { quiz: { keys: { answerIndex: number }[] } }).quiz.keys;
  const answers = keys.map((k, i) => (i < 3 ? k.answerIndex : (k.answerIndex + 1) % 4));
  const graded = await request(a).post(`/api/proofs/${res.body.quiz.proofId}/quiz`).set(auth(token)).send({ answers });
  assert.equal(graded.status, 200);
  assertContract(SessionProofResponseSchema, graded.body);
  assert.equal(graded.body.proof.status, "accepted");
  assert.equal(graded.body.completed, true);
  assert.deepEqual(graded.body.proof.evidence, ["50 min on Thermodynamics and entropy", "quiz 3/5"]);
  assert.ok((await score(id, "MIND")).score > 24);
  const again = await request(a).post(`/api/proofs/${res.body.quiz.proofId}/quiz`).set(auth(token)).send({ answers });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "quiz_closed");
});

test("study: 2 of 5 right is rejected and the quest stays open; too short a session gets no quiz", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id, "Study physics for 45 minutes", { domain: "MIND" });
  const short = await request(a).post(`/api/quests/${q.id}/session`).set(auth(token)).send({ summary: study(20, "Optics") });
  assert.equal(short.body.proof.status, "rejected");
  assert.match(short.body.proof.reason, /20 of 45 minutes/);
  assert.equal(short.body.quiz, null);
  const res = await request(a).post(`/api/quests/${q.id}/session`).set(auth(token)).send({ summary: study(46, "Newton's laws of motion") });
  const [stored] = await db!.select().from(questProofs).where(eq(questProofs.id, res.body.quiz.proofId));
  const keys = (stored!.summary as { quiz: { keys: { answerIndex: number }[] } }).quiz.keys;
  const answers = keys.map((k, i) => (i < 2 ? k.answerIndex : (k.answerIndex + 1) % 4));
  const graded = await request(a).post(`/api/proofs/${res.body.quiz.proofId}/quiz`).set(auth(token)).send({ answers });
  assert.equal(graded.body.proof.status, "rejected");
  assert.match(graded.body.proof.reason, /2 of 5 correct/);
  const [row] = await db!.select().from(quests).where(eq(quests.id, q.id));
  assert.equal(row!.status, "active");
});

test("study: a topic outside the bank asks for an explanation; with the AI down it waits for review", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id, "Study for 45 minutes", { domain: "MIND" });
  const res = await request(a).post(`/api/quests/${q.id}/session`).set(auth(token)).send({ summary: study(50, "Carnatic music ragas") });
  assert.equal(res.body.quiz.source, "explain");
  assert.equal(res.body.quiz.questions.length, 1);
  const graded = await request(a)
    .post(`/api/proofs/${res.body.quiz.proofId}/quiz`)
    .set(auth(token))
    .send({ answers: ["A raga is a melodic framework with set ascending and descending notes. Melakarta ragas are the 72 parent scales."] });
  assert.equal(graded.body.proof.status, "awaiting_review");
  assert.equal(graded.body.completed, false);
  const review = await request(a).post(`/api/proofs/${res.body.quiz.proofId}/review`).set(auth(token)).send({});
  assert.equal(review.status, 200);
  assert.equal(review.body.proof.status, "awaiting_review", "still waiting while the AI is down");
});

test("study: a workout session can't prove a study quest, and a tap can't either", { skip }, async () => {
  const a = app();
  const { token, id } = await setup(a);
  const q = await mkQuest(id, "Study physics for 45 minutes", { domain: "MIND" });
  const wrong = await request(a).post(`/api/quests/${q.id}/session`).set(auth(token)).send({ summary: summary({ activeMinutes: 60 }) });
  assert.equal(wrong.status, 409);
  const tap = await request(a).post(`/api/quests/${q.id}/complete`).set(auth(token)).send({});
  assert.equal(tap.status, 409);
  assert.equal(tap.body.code, "proof_required");
});
