import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { dailySnapshots, profiles, shadowSelves, users } from "@workspace/db";
import { addDays, localDate } from "@workspace/engine";
import { GameStateSchema, type UiState } from "@workspace/contracts";
import { grantEntitlement } from "../services/entitlements";
import { buildGameState } from "../services/state";
import { TZ, app, assertContract, auth, db, setup, skip } from "./game-test-helpers";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const now = new Date();
const today = localDate(now, TZ);

/** Puts the user into a known (shadow, trajectory, rank) situation by writing the rows the server reads. */
async function arrange(id: string, o: { shadow: boolean; traj: "up" | "down" | "stable"; rank: "E" | "C" | "A" | "S" }) {
  await db!.update(profiles).set({ rank: o.rank }).where(eq(profiles.userId, id));
  await db!.delete(shadowSelves).where(eq(shadowSelves.userId, id));
  if (o.shadow) {
    await db!.insert(shadowSelves).values({
      userId: id,
      active: true,
      codename: "SHADOW // TEST",
      initialScores: { BODY: 50, MIND: 50, WEALTH: 50, SOCIAL: 50, DISCIPLINE: 50 },
      gainRates: { BODY: 0.1, MIND: 0.1, WEALTH: 0.1, SOCIAL: 0.1, DISCIPLINE: 0.1 },
      activatedAt: now,
    });
  }
  await db!.delete(dailySnapshots).where(eq(dailySnapshots.userId, id));
  const current = (await buildGameState(db!, id, now))!; // hidden is not exposed; use a huge offset instead
  assert.ok(current);
  const hidden = o.traj === "up" ? -1000 : o.traj === "down" ? 1000 : null;
  if (hidden !== null) {
    await db!.insert(dailySnapshots).values({ userId: id, localDate: addDays(today, -1), scores: {}, hidden, rank: o.rank });
  }
}

const cases: { shadow: boolean; traj: "up" | "down" | "stable"; rank: "E" | "C" | "A" | "S"; want: UiState }[] = [
  { shadow: true, traj: "down", rank: "S", want: "FALLING" },
  { shadow: false, traj: "down", rank: "C", want: "STABLE" },
  { shadow: true, traj: "up", rank: "A", want: "PEAK" },
  { shadow: false, traj: "up", rank: "S", want: "PEAK" },
  { shadow: false, traj: "up", rank: "C", want: "CLIMBING" },
  { shadow: true, traj: "up", rank: "E", want: "CLIMBING" },
  { shadow: false, traj: "stable", rank: "A", want: "STABLE" },
];

test("uiState: PRO users follow the rule matrix; free users always get STABLE", { skip }, async () => {
  const a = app({ now: () => now });
  const { id } = await setup(a);
  for (const c of cases) {
    await arrange(id, c);
    await grantEntitlement(db!, id, "pro", null, now);
    const pro = (await buildGameState(db!, id, now))!;
    assert.equal(pro.uiState, c.want, `pro ${JSON.stringify(c)}`);
    await grantEntitlement(db!, id, "free", null, now);
    const free = (await buildGameState(db!, id, now))!;
    assert.equal(free.uiState, "STABLE", `free ${JSON.stringify(c)}`);
  }
});

test("uiState: an expired PRO grant reads STABLE", { skip }, async () => {
  const a = app({ now: () => now });
  const { id } = await setup(a);
  await arrange(id, { shadow: true, traj: "down", rank: "C" });
  await grantEntitlement(db!, id, "pro", new Date(now.getTime() - 1000), new Date(now.getTime() - 86_400_000));
  assert.equal((await buildGameState(db!, id, now))!.uiState, "STABLE");
});

test("GET /api/state ?uiState= override is honoured for admins only and validated", { skip }, async () => {
  const a = app({ now: () => now });
  const user = await setup(a, { email: "u@example.com", username: "plain_user" });
  const admin = await setup(a, { email: "adm@example.com", username: "admin_user" });
  await db!.update(users).set({ role: "admin" }).where(eq(users.id, admin.id));

  for (const s of ["FALLING", "STABLE", "CLIMBING", "PEAK"] as const) {
    const res = await request(a).get(`/api/state?uiState=${s}`).set(auth(admin.token));
    assert.equal(res.status, 200);
    assert.equal(assertContract(GameStateSchema, res.body).uiState, s);
  }
  // admin with an invalid value: ignored, normal (free => STABLE) state
  const bad = await request(a).get("/api/state?uiState=BOGUS").set(auth(admin.token));
  assert.equal(bad.status, 200);
  assert.equal(bad.body.uiState, "STABLE");
  const lower = await request(a).get("/api/state?uiState=peak").set(auth(admin.token));
  assert.equal(lower.body.uiState, "STABLE");

  // non-admin: no change, not an error
  const res = await request(a).get("/api/state?uiState=PEAK").set(auth(user.token));
  assert.equal(res.status, 200);
  assert.equal(res.body.uiState, "STABLE");
  // a non-admin PRO user is not overridden either
  await grantEntitlement(db!, user.id, "pro", null, now);
  await arrange(user.id, { shadow: true, traj: "down", rank: "C" });
  const pro = await request(a).get("/api/state?uiState=PEAK").set(auth(user.token));
  assert.equal(pro.body.uiState, "FALLING");
});
