import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { domainScores, logs, profiles, quests, rivalAssignments } from "@workspace/db";
import { RivalsResponseSchema, type RivalsResponse } from "@workspace/contracts";
import { app, assertContract, auth, db, setup, skip } from "./game-test-helpers";
import { grantEntitlement } from "../services/entitlements";
import { buildMessagePrompt, buildQuestPrompt, buildUserContext } from "../services/ai-context";
import { usersWithExpiredSlots } from "../services/rivals";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

let clock = new Date();
const a = () => app({ now: () => clock });

async function mk(name: string, opts: { pro?: boolean; identity?: "anonymous" | "public" } = {}) {
  const { token, id } = await setup(a(), { email: `${name}@example.com`, username: name });
  if (opts.identity === "public") {
    assert.equal((await request(a()).patch("/api/profile").set(auth(token)).send({ identitySetting: "public" })).status, 200);
  }
  if (opts.pro) await grantEntitlement(db!, id, "pro", null, clock);
  return { token, id, name };
}
async function rankD(id: string, value: number) {
  await db!.update(profiles).set({ rank: "D" }).where(eq(profiles.userId, id));
  await db!.update(domainScores).set({ score: value }).where(eq(domainScores.userId, id));
  await db!.insert(logs).values({ userId: id, clientId: `l-${id}`, domain: "BODY", logType: "x", occurredAt: clock, localDate: clock.toISOString().slice(0, 10) });
}
const rivalsOf = async (token: string): Promise<RivalsResponse> => {
  const res = await request(a()).get("/api/rivals").set(auth(token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return assertContract(RivalsResponseSchema, res.body);
};

// ---- rival reveal ----------------------------------------------------------------------------------------

test("rival reveal: a PRO viewer sees a public rival's username; a free viewer and an anonymous rival stay codenames", { skip }, async () => {
  clock = new Date();
  const proViewer = await mk("pro_viewer", { pro: true });
  const freeViewer = await mk("free_viewer");
  const pub = await mk("pub_rival", { identity: "public" });
  for (const [u, v] of [[proViewer, 33], [freeViewer, 34], [pub, 35]] as const) await rankD(u.id, v);

  // pair each viewer with the public rival explicitly so the check does not depend on matching order
  const mkAsg = (viewer: string, rival: string, codename: string) =>
    db!.insert(rivalAssignments).values({ userId: viewer, slot: 1, rivalUserId: rival, codename, assignedAt: clock, expiresAt: new Date(clock.getTime() + 86_400_000) });
  await db!.delete(rivalAssignments).where(eq(rivalAssignments.userId, proViewer.id));
  await db!.delete(rivalAssignments).where(eq(rivalAssignments.userId, freeViewer.id));
  await mkAsg(proViewer.id, pub.id, "RIVAL // ALPHA-1");
  await mkAsg(freeViewer.id, pub.id, "RIVAL // BETA-2");
  const pro1 = (await rivalsOf(proViewer.token)).rivals.find((r) => r.slot === 1)!;
  assert.equal(pro1.profile.handle, "pub_rival");
  assert.equal(pro1.profile.isCodename, false);
  const free1 = (await rivalsOf(freeViewer.token)).rivals.find((r) => r.slot === 1)!;
  assert.equal(free1.profile.handle, "RIVAL // BETA-2");
  assert.equal(free1.profile.isCodename, true);

  // an anonymous rival is never revealed, not even to PRO
  const anon = await mk("anon_rival");
  await rankD(anon.id, 34);
  await db!.delete(rivalAssignments).where(eq(rivalAssignments.userId, proViewer.id));
  await mkAsg(proViewer.id, anon.id, "RIVAL // GAMMA-3");
  const anon1 = (await rivalsOf(proViewer.token)).rivals.find((r) => r.slot === 1)!;
  assert.equal(anon1.profile.handle, "RIVAL // GAMMA-3");
  assert.equal(anon1.profile.isCodename, true);
});

// ---- priority matching -----------------------------------------------------------------------------------

test("priority matching: seekers with an expired slot are taken PRO first, then longest expired; PRO still passes a tight limit", { skip }, async () => {
  clock = new Date();
  const freeOld = await mk("seek_free_old");
  const freeNew = await mk("seek_free_new");
  const proNew = await mk("seek_pro_new", { pro: true });
  const proOld = await mk("seek_pro_old", { pro: true });
  const target = await mk("seek_target");
  const ago = (min: number) => new Date(clock.getTime() - min * 60_000);
  for (const [u, min] of [[freeOld, 50], [freeNew, 2], [proNew, 1], [proOld, 20]] as const) {
    await db!.insert(rivalAssignments).values({ userId: u.id, slot: 1, codename: `RIVAL // X-${min}`, assignedAt: ago(100), expiresAt: ago(min), ghostId: null, rivalUserId: target.id });
  }
  assert.deepEqual(await usersWithExpiredSlots(db!, clock, 10), [proOld.id, proNew.id, freeOld.id, freeNew.id]);
  assert.deepEqual(await usersWithExpiredSlots(db!, clock, 2), [proOld.id, proNew.id], "PRO fills a small batch first");
  // an expired PRO entitlement does not jump the queue
  await grantEntitlement(db!, proNew.id, "pro", ago(5), ago(60));
  assert.deepEqual(await usersWithExpiredSlots(db!, clock, 10), [proOld.id, freeOld.id, freeNew.id, proNew.id]);
});

// ---- AI context depth and word limits ---------------------------------------------------------------------

async function withHistory(id: string, token: string) {
  const res = await request(a()).post("/api/logs").set(auth(token)).send({
    clientId: "hist-1", domain: "MIND", logType: "reading", data: { pages: 12 }, freeText: "zebra-quoted-phrase from the reading log",
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await db!.insert(quests).values({
    userId: id, type: "daily", title: "T", description: "d", domain: "MIND", status: "refused", expiresAt: clock, resolvedAt: clock,
    resolvedLocalDate: clock.toISOString().slice(0, 10), refusalReason: "walrus-refusal-reason",
  });
}

test("free message prompts carry the base context only: no past-log or refusal quotes, 60% of the word cap rounded down", { skip }, async () => {
  clock = new Date();
  const free = await mk("ctx_free");
  const pro = await mk("ctx_pro", { pro: true });
  await withHistory(free.id, free.token);
  await withHistory(pro.id, pro.token);
  const freeCtx = (await buildUserContext(db!, free.id, clock))!;
  const proCtx = (await buildUserContext(db!, pro.id, clock))!;
  const types = ["morning_briefing", "nightly_debrief", "quest_assignment", "weekly_debrief", "shadow_confrontation"] as const;
  const caps: Record<string, number> = { morning_briefing: 80, nightly_debrief: 100, quest_assignment: 40, weekly_debrief: 140, shadow_confrontation: 55 };
  for (const t of types) {
    const f = buildMessagePrompt(t, freeCtx);
    assert.ok(!f.prompt.includes("zebra-quoted-phrase"), `${t}: no past-log quote`);
    assert.ok(!f.prompt.includes("walrus-refusal-reason"), `${t}: no refusal quote`);
    assert.ok(!f.prompt.includes("Quote up to 3"), `${t}: no quoted-words instruction`);
    assert.equal(f.maxWords, Math.floor(caps[t]! * 0.6), t);
    assert.ok(f.prompt.includes(`Maximum ${Math.floor(caps[t]! * 0.6)} words`), t);
    assert.ok(f.prompt.includes("Current rank:") && f.prompt.includes("Domain scores:"), "base context stays");
    const p = buildMessagePrompt(t, proCtx);
    assert.ok(p.prompt.includes("zebra-quoted-phrase"), `${t}: PRO gets the past-log reference`);
    assert.ok(p.prompt.includes("walrus-refusal-reason"), `${t}: PRO gets the refusal reason`);
    assert.equal(p.maxWords, caps[t], t);
  }
  assert.ok(buildMessagePrompt("morning_briefing", proCtx).prompt.includes("Quote up to 3"));
  // quest generation is not the SYSTEM persona: both tiers keep the full context there
  const need = { daily: 1, weekly: 0, arc: 0 };
  assert.ok(buildQuestPrompt(freeCtx, need).includes("zebra-quoted-phrase"));
});
