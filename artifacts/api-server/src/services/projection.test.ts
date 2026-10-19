import test from "node:test";
import assert from "node:assert/strict";
import { PublicProfileSchema } from "@workspace/contracts";
import { projectUser, type ProjectionSubject, type Relation } from "./projection";

const SCORES = { BODY: 41, MIND: 52, WEALTH: 33, SOCIAL: 64, DISCIPLINE: 27 };
const subject = (identitySetting: ProjectionSubject["identitySetting"], clanTag?: string): ProjectionSubject => ({
  userId: "11111111-1111-4111-8111-111111111111",
  username: "alice_1",
  identitySetting,
  publicCodename: "USER // BOLT-3",
  rank: "C",
  scores: SCORES,
  trajectory: "up",
  shadowActive: true,
  clanTag,
});
const RELATIONS: Relation[] = ["self", "clanmate", "duo", "follower", "rival", "public"];
const IDENTITIES = ["anonymous", "semi-public", "public"] as const;

// handle shown as username? (true) or codename (false), per [identity][relation]
const USERNAME_SHOWN: Record<(typeof IDENTITIES)[number], Record<Relation, boolean>> = {
  anonymous: { self: true, clanmate: true, duo: true, follower: false, rival: false, public: false },
  "semi-public": { self: true, clanmate: true, duo: true, follower: false, rival: false, public: false },
  public: { self: true, clanmate: true, duo: true, follower: true, rival: false, public: true },
};
const SCORES_SHOWN: Record<Relation, boolean> = { self: true, clanmate: true, duo: false, follower: false, rival: true, public: false };

for (const identity of IDENTITIES) {
  for (const relation of RELATIONS) {
    test(`projection matrix: ${identity} x ${relation}`, () => {
      const p = projectUser(subject(identity), relation, { rivalCodename: "RIVAL // ASH-2" });
      PublicProfileSchema.parse(p);
      const expectUsername = USERNAME_SHOWN[identity][relation];
      const expectedHandle = expectUsername ? "alice_1" : relation === "rival" ? "RIVAL // ASH-2" : "USER // BOLT-3";
      assert.equal(p.handle, expectedHandle);
      assert.equal(p.isCodename, !expectUsername);
      assert.equal(p.rank, "C");
      assert.equal(p.trajectory, "up");
      assert.equal(p.shadowActive, true);
      assert.deepEqual(p.scores, SCORES_SHOWN[relation] ? SCORES : undefined);
      assert.equal("scores" in p, SCORES_SHOWN[relation]);
    });
  }
}

test("a rival sees a public user's username only with rivalReveal, else the rival codename", () => {
  assert.equal(projectUser(subject("public"), "rival", { rivalCodename: "RIVAL // ASH-2" }).handle, "RIVAL // ASH-2");
  assert.equal(projectUser(subject("public"), "rival", { rivalCodename: "RIVAL // ASH-2", rivalReveal: false }).handle, "RIVAL // ASH-2");
  const revealed = projectUser(subject("public"), "rival", { rivalCodename: "RIVAL // ASH-2", rivalReveal: true });
  assert.equal(revealed.handle, "alice_1");
  assert.equal(revealed.isCodename, false);
  // reveal never unmasks semi-public or anonymous users
  assert.equal(projectUser(subject("semi-public"), "rival", { rivalCodename: "RIVAL // ASH-2", rivalReveal: true }).handle, "RIVAL // ASH-2");
  assert.equal(projectUser(subject("anonymous"), "rival", { rivalCodename: "RIVAL // ASH-2", rivalReveal: true }).handle, "RIVAL // ASH-2");
});

test("a rival without an assignment codename falls back to the public codename, never the username", () => {
  const p = projectUser(subject("public"), "rival");
  assert.equal(p.handle, "USER // BOLT-3");
  assert.equal(p.isCodename, true);
});

test("clan tag is hidden for anonymous users except to clanmates and self, and never reaches a rival", () => {
  for (const relation of RELATIONS) {
    const anon = projectUser(subject("anonymous", "ORDR"), relation);
    assert.equal(anon.clanTag, relation === "clanmate" || relation === "self" ? "ORDR" : undefined, `anonymous/${relation}`);
    assert.equal("clanTag" in anon, relation === "clanmate" || relation === "self");
    for (const identity of ["semi-public", "public"] as const) {
      // PRD 14: a rival is shown by assignment codename only, never with a clan affiliation.
      const expected = relation === "rival" ? undefined : "ORDR";
      assert.equal(projectUser(subject(identity, "ORDR"), relation).clanTag, expected, `${identity}/${relation}`);
      assert.equal("clanTag" in projectUser(subject(identity, "ORDR"), relation), relation !== "rival");
    }
  }
  assert.equal("clanTag" in projectUser(subject("public"), "public"), false);
});

test("a follower sees rank, trajectory and shadowActive only (PRD 16)", () => {
  const p = projectUser(subject("public", "ORDR"), "follower");
  assert.deepEqual(Object.keys(p).sort(), ["clanTag", "handle", "isCodename", "rank", "shadowActive", "trajectory"]);
});

test("no projection carries a user id, hidden score or a field outside PublicProfile", () => {
  const allowed = new Set(["handle", "isCodename", "rank", "trajectory", "shadowActive", "scores", "clanTag", "customDomains"]);
  const withExtras = { ...subject("public", "ORDR"), hidden: 55.5, email: "a@x.com" } as ProjectionSubject;
  for (const relation of RELATIONS) {
    const p = projectUser(withExtras, relation, { rivalCodename: "RIVAL // ASH-2" });
    for (const k of Object.keys(p)) assert.ok(allowed.has(k), k);
    assert.ok(!JSON.stringify(p).includes("55.5"));
    assert.ok(!JSON.stringify(p).includes("a@x.com"));
    assert.ok(!JSON.stringify(p).includes("11111111"));
  }
});

test("the projected scores are a copy", () => {
  const s = subject("public");
  const p = projectUser(s, "self");
  p.scores!.BODY = 99;
  assert.equal(s.scores.BODY, 41);
});

test("public custom domains (name + score only) reach self, clanmate, duo and follower, never a rival or a stranger", () => {
  const withCustom = {
    ...subject("public"),
    customDomains: [{ name: "Cold Plunge", score: 61.5, extra: "note", id: "x" } as { name: string; score: number }],
  };
  for (const relation of RELATIONS) {
    const p = projectUser(withCustom, relation, { rivalCodename: "RIVAL // ASH-2" });
    PublicProfileSchema.parse(p);
    if (relation === "rival" || relation === "public") {
      assert.equal("customDomains" in p, false, relation);
    } else {
      assert.deepEqual(p.customDomains, [{ name: "Cold Plunge", score: 61.5 }], relation);
    }
  }
  assert.equal("customDomains" in projectUser(subject("public"), "follower"), false, "none when the subject has no public ones");
});
