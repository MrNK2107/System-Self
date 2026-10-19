import { test } from "node:test";
import assert from "node:assert/strict";
import { RANKED_DOMAINS, type RankedDomain } from "./constants";
import { GHOST_SCORE_SPREAD, ghostDrift, makeGhost, rankBandMidpoint, seededRng, type GhostState } from "./ghosts";

const scores = (v: number) => Object.fromEntries(RANKED_DOMAINS.map((d) => [d, v])) as Record<RankedDomain, number>;
const ghost = (over: Partial<GhostState> = {}): GhostState => ({
  id: "6b1d0c7e-1111-4222-8333-444455556666",
  rank: "D",
  scores: scores(33),
  trajectory: "up",
  shadowActive: false,
  ...over,
});

test("seededRng is deterministic per seed and stays in [0, 1)", () => {
  const a = seededRng("x:2026-01-01");
  const b = seededRng("x:2026-01-01");
  const c = seededRng("x:2026-01-02");
  const as = Array.from({ length: 50 }, () => a());
  assert.deepEqual(as, Array.from({ length: 50 }, () => b()));
  assert.notDeepEqual(as, Array.from({ length: 50 }, () => c()));
  for (const v of as) assert.ok(v >= 0 && v < 1);
});

test("ghost drift is deterministic per date", () => {
  const g = ghost();
  assert.deepEqual(ghostDrift(g, "2026-03-04"), ghostDrift(g, "2026-03-04"));
  assert.notDeepEqual(ghostDrift(g, "2026-03-04").scores, ghostDrift(g, "2026-03-05").scores);
  // seeded by ghost id too
  assert.notDeepEqual(ghostDrift(g, "2026-03-04").scores, ghostDrift({ ...g, id: "other" }, "2026-03-04").scores);
});

test("drift follows the old client formulas for all five domains", () => {
  const date = "2026-03-04";
  for (const trajectory of ["up", "down", "stable"] as const) {
    const g = ghost({ trajectory });
    const next = ghostDrift(g, date);
    const r = seededRng(`${g.id}:${date}`);
    const r0 = r();
    const base = trajectory === "up" ? 0.35 + r0 * 0.45 : trajectory === "down" ? -(0.25 + r0 * 0.35) : (r0 - 0.5) * 0.18;
    for (const d of RANKED_DOMAINS) {
      const expected = Math.round((33 + base * (0.4 + r() * 0.6)) * 100) / 100;
      assert.equal(next.scores[d], expected, `${trajectory} ${d}`);
    }
    if (trajectory === "up") for (const d of RANKED_DOMAINS) assert.ok(next.scores[d] > 33);
    if (trajectory === "down") for (const d of RANKED_DOMAINS) assert.ok(next.scores[d] < 33);
    // identity, rank, trajectory and shadow are unchanged
    assert.equal(next.id, g.id);
    assert.equal(next.rank, g.rank);
    assert.equal(next.trajectory, trajectory);
    assert.equal(next.shadowActive, g.shadowActive);
  }
});

test("drift clamps scores to 1..99", () => {
  assert.ok(Object.values(ghostDrift(ghost({ scores: scores(99), trajectory: "up" }), "2026-01-01").scores).every((v) => v === 99));
  assert.ok(Object.values(ghostDrift(ghost({ scores: scores(1), trajectory: "down" }), "2026-01-01").scores).every((v) => v === 1));
});

test("makeGhost centres scores on the owner's rank band midpoint within +-6", () => {
  for (const rank of ["E", "D", "C", "B", "A", "S"] as const) {
    const mid = rankBandMidpoint(rank);
    for (let i = 0; i < 40; i++) {
      const g = makeGhost(rank, seededRng(`${rank}:${i}`));
      assert.equal(g.rank, rank);
      assert.ok(["up", "stable", "down"].includes(g.trajectory));
      assert.equal(typeof g.shadowActive, "boolean");
      for (const d of RANKED_DOMAINS) {
        assert.ok(Math.abs(g.scores[d] - mid) <= GHOST_SCORE_SPREAD + 1e-9, `${rank} ${d} ${g.scores[d]}`);
        assert.ok(g.scores[d] >= 1 && g.scores[d] <= 99);
      }
    }
  }
  assert.equal(rankBandMidpoint("E"), 12.5);
  assert.equal(rankBandMidpoint("D"), 33);
  assert.equal(rankBandMidpoint("B"), 63);
});

test("makeGhost is deterministic for a seeded rng", () => {
  assert.deepEqual(makeGhost("C", seededRng("s")), makeGhost("C", seededRng("s")));
});
