import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTICE_KINDS } from "@workspace/contracts";
import { NOTICE_KINDS_PARAM, NOTICE_ORDER, mergeNotices, nextNoticeGroup, noticeView, parseNotices } from "./notices";

let seq = 0;
const at = () => new Date(Date.UTC(2026, 9, 19, 10, 0, seq++)).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const rank = (n: number) => ({
  id: id(n),
  kind: "rank_change",
  payload: { from: "E", to: "D", kind: "promotion", newCodename: "VECTOR // AB1-2" },
  createdAt: at(),
});
const ach = (n: number) => ({
  id: id(n),
  kind: "achievement",
  payload: { id: "first_log", title: "FIRST TRANSMISSION", description: "Log your first entry", icon: "zap" },
  createdAt: at(),
});
const mile = (n: number) => ({ id: id(n), kind: "milestone", payload: { domain: "BODY", tier: 60, title: "CONDITIONED" }, createdAt: at() });
const failed = (n: number) => ({
  id: id(n),
  kind: "quest_failed",
  payload: { questId: id(900 + n), title: `Quest ${n}`, type: "daily", penalty: 0.8 },
  createdAt: at(),
});
const mark = () => ({ id: id(72), kind: "returner_mark", payload: { count: 1, line: "Returned ×1." }, createdAt: at() });
const streak = (n: number) => ({
  id: id(n),
  kind: "streak_break",
  payload: { domains: [{ domain: "SOCIAL", lostStreak: 4 }], penalty: 2 },
  createdAt: at(),
});

test("NOTICE_ORDER covers every server notice kind exactly once", () => {
  assert.deepEqual([...NOTICE_ORDER].sort(), [...NOTICE_KINDS].sort());
  assert.deepEqual(NOTICE_ORDER, [
    "rank_change",
    "achievement",
    "milestone",
    "streak_break",
    "chain_complete",
    "shadow_activated",
    "shadow_resolved",
    "quest_failed",
    "comeback",
    "returner_mark",
    "gym_unlocked",
    "rival_challenge_result",
    "rival_passed",
    "raid_result",
    "challenge_received",
    "challenge_result",
    "shame",
  ]);
  // The kinds filter sent with every notice read is exactly this list.
  assert.equal(NOTICE_KINDS_PARAM, NOTICE_ORDER.join(","));
});

test("comeback, returner mark and gym unlock render as SYSTEM modals after chain_complete", () => {
  const comeback = (offer: boolean) => ({
    id: id(60),
    kind: "comeback",
    payload: { gapDays: 9, line: "You returned. Most don't.", offerHomePath: offer },
    createdAt: at(),
  });
  const mark = { id: id(61), kind: "returner_mark", payload: { count: 2, line: "Returned ×2." }, createdAt: at() };
  const gym = { id: id(62), kind: "gym_unlocked", payload: { line: "Tier I cleared. The gym is open to you now." }, createdAt: at() };
  const parsed = parseNotices([gym, mark, comeback(true), failed(63)]).notices;
  const order: string[] = [];
  const ack = new Set<string>();
  for (let g = nextNoticeGroup(parsed, ack); g; g = nextNoticeGroup(parsed, ack)) {
    order.push(g.kind);
    g.notices.forEach((n) => ack.add(n.id));
  }
  assert.deepEqual(order, ["quest_failed", "comeback", "returner_mark", "gym_unlocked"]);

  const [offer, plain] = [comeback(true), comeback(false)].map((n) => noticeView({ kind: "comeback", notices: parseNotices([n]).notices }));
  assert.deepEqual(offer, { modal: "comeback", gapDays: 9, line: "You returned. Most don't.", offerHomePath: true });
  assert.equal(plain!.modal === "comeback" && plain!.offerHomePath, false);
  assert.deepEqual(noticeView({ kind: "returner_mark", notices: parseNotices([mark]).notices }), {
    modal: "system",
    tone: "info",
    label: "RETURNER",
    title: "Returned ×2.",
    body: "Recorded. It pays nothing and it cannot be taken back.",
  });
  assert.deepEqual(noticeView({ kind: "gym_unlocked", notices: parseNotices([gym]).notices }), {
    modal: "system",
    tone: "info",
    label: "TIER I CLEARED",
    title: "The gym is open to you now.",
    body: "Tier I cleared. The gym is open to you now.",
  });
});

test("rival notices: pressure is a SYSTEM alert, a challenge result opens the outcome modal", () => {
  const passed = { id: id(70), kind: "rival_passed", payload: { codename: "RIVAL // ASH-3", domain: "MIND", isGhost: false }, createdAt: at() };
  const payload = {
    challengeId: id(80),
    codename: "RIVAL // OAK-1",
    domain: "SOCIAL",
    outcome: "loss",
    startDate: "2026-01-01",
    endDate: "2026-01-07",
    userStart: 20,
    userEnd: 21,
    rivalStart: 30,
    rivalEnd: 33,
  };
  const result = { id: id(71), kind: "rival_challenge_result", payload, createdAt: at() };
  const parsed = parseNotices([passed, result, mark()]).notices;
  const order: string[] = [];
  const ack = new Set<string>();
  for (let g = nextNoticeGroup(parsed, ack); g; g = nextNoticeGroup(parsed, ack)) {
    order.push(g.kind);
    g.notices.forEach((n) => ack.add(n.id));
  }
  assert.deepEqual(order, ["returner_mark", "rival_challenge_result", "rival_passed"]);
  assert.deepEqual(noticeView({ kind: "rival_passed", notices: parseNotices([passed]).notices }), {
    modal: "system",
    tone: "alert",
    label: "RIVAL PRESSURE",
    title: "RIVAL // ASH-3 passed your MIND score.",
    body: "The order changed overnight. It is logged.",
  });
  const { challengeId: _ignored, ...shown } = payload;
  assert.deepEqual(noticeView({ kind: "rival_challenge_result", notices: parseNotices([result]).notices }), {
    modal: "challenge_result",
    result: shown,
  });
});

test("parseNotices keeps known notices and skips unknown or malformed ones without reporting ids to mark seen", () => {
  const raw = [
    ach(1),
    { id: id(2), kind: "future_kind", payload: { x: 1 }, createdAt: at() },
    { id: id(3), kind: "milestone", payload: { domain: "NOPE", tier: 60, title: "x" }, createdAt: at() },
    { kind: "achievement" }, // no id: cannot be marked seen, dropped
    "garbage",
  ];
  const result = parseNotices(raw);
  assert.deepEqual(result.notices.map((n) => n.id), [id(1)]);
  // A newer client may understand them: they stay unseen on the server, nothing here marks them.
  assert.deepEqual(Object.keys(result).sort(), ["notices", "skipped"]);
  assert.equal(result.skipped, 4);
  assert.equal(nextNoticeGroup(parseNotices([raw[1], raw[2]]).notices, new Set()), null);
});

test("nextNoticeGroup shows one notice at a time in kind order, oldest first within a kind", () => {
  const { notices } = parseNotices([failed(1), mile(2), ach(3), ach(4), rank(5), streak(6)]);
  const done = new Set<string>();
  const shown: string[] = [];
  for (let g = nextNoticeGroup(notices, done); g; g = nextNoticeGroup(notices, done)) {
    shown.push(`${g.kind}:${g.notices.map((n) => n.id.slice(-1)).join(",")}`);
    g.notices.forEach((n) => done.add(n.id));
  }
  assert.deepEqual(shown, ["rank_change:5", "achievement:3", "achievement:4", "milestone:2", "streak_break:6", "quest_failed:1"]);
});

test("quest_failed notices are grouped into one batch", () => {
  const { notices } = parseNotices([failed(1), failed(2), failed(3)]);
  const g = nextNoticeGroup(notices, new Set());
  assert.equal(g?.kind, "quest_failed");
  assert.deepEqual(g?.notices.map((n) => n.id), [id(1), id(2), id(3)]);
  assert.equal(nextNoticeGroup(notices, new Set([id(1), id(2), id(3)])), null);
});

test("nextNoticeGroup skips acknowledged notices and returns null when none remain", () => {
  const { notices } = parseNotices([rank(1), ach(2)]);
  assert.equal(nextNoticeGroup(notices, new Set([id(1)]))?.notices[0]?.id, id(2));
  assert.equal(nextNoticeGroup(notices, new Set([id(1), id(2)])), null);
  assert.equal(nextNoticeGroup([], new Set()), null);
});

test("mergeNotices de-duplicates by id, keeping the first copy", () => {
  const a = parseNotices([ach(1), mile(2)]).notices;
  const b = parseNotices([mile(2), rank(3)]).notices;
  assert.deepEqual(mergeNotices(a, b).map((n) => n.id), [id(1), id(2), id(3)]);
});

test("noticeView maps payloads to the existing modals' props", () => {
  const one = (raw: unknown) => {
    const { notices } = parseNotices([raw]);
    const g = nextNoticeGroup(notices, new Set());
    assert.ok(g);
    return noticeView(g);
  };

  assert.deepEqual(one(rank(1)), { modal: "rank_up", fromRank: "E", toRank: "D", newCodename: "VECTOR // AB1-2" });

  const demotion = one({ ...rank(2), payload: { from: "C", to: "D", kind: "demotion", newCodename: "VECTOR // ZZ9-1" } });
  assert.equal(demotion.modal, "system");
  assert.ok(demotion.modal === "system" && demotion.title.includes("D") && demotion.body.includes("VECTOR // ZZ9-1"));

  assert.deepEqual(one(ach(3)), {
    modal: "achievement",
    achievement: { id: "first_log", title: "FIRST TRANSMISSION", description: "Log your first entry", icon: "zap" },
  });
  assert.deepEqual(one(mile(4)), { modal: "milestone", milestone: { domain: "BODY", tier: 60, title: "CONDITIONED" } });

  const s = streak(5);
  assert.deepEqual(one(s), {
    modal: "streak_break",
    data: { detectedAt: s.createdAt, brokenDomains: [{ domain: "SOCIAL", lostStreak: 4 }], penalty: 2, aiText: "" },
  });

  const chain = one({ id: id(6), kind: "chain_complete", payload: { name: "DISCIPLINE FORGE", templateKey: "discipline_forge" }, createdAt: at() });
  assert.ok(chain.modal === "system" && chain.title === "DISCIPLINE FORGE");
  const act = one({ id: id(7), kind: "shadow_activated", payload: { gap: 12.5, codename: "SHADOW // ALPHA" }, createdAt: at() });
  assert.ok(act.modal === "system" && act.body.includes("12.5"));
  const res = one({ id: id(8), kind: "shadow_resolved", payload: { codename: "SHADOW // ALPHA" }, createdAt: at() });
  assert.ok(res.modal === "system" && res.title === "SHADOW // ALPHA");

  const { notices } = parseNotices([failed(9), { ...failed(10), payload: { questId: id(1), title: "Weekly", type: "weekly", penalty: 2 } }]);
  const g = nextNoticeGroup(notices, new Set());
  assert.ok(g);
  assert.deepEqual(noticeView(g), {
    modal: "failure",
    failures: [
      { title: "Quest 9", type: "daily", penalty: 0.8 },
      { title: "Weekly", type: "weekly", penalty: 2 },
    ],
  });
});

const passedN = (n: number, codename: string, domain: string, isGhost?: boolean) => ({
  id: id(n),
  kind: "rival_passed",
  payload: { codename, domain, ...(isGhost === undefined ? {} : { isGhost }) },
  createdAt: at(),
});

test("rival_passed notices are grouped into one batch like quest_failed", () => {
  const { notices } = parseNotices([passedN(1, "RIVAL // ASH-3", "MIND", false), passedN(2, "RIVAL // OAK-1", "BODY", true), passedN(3, "RIVAL // ELM-2", "WEALTH")]);
  const g = nextNoticeGroup(notices, new Set());
  assert.equal(g?.kind, "rival_passed");
  assert.deepEqual(g?.notices.map((n) => n.id), [id(1), id(2), id(3)]);
  assert.equal(nextNoticeGroup(notices, new Set([id(1), id(2), id(3)])), null);
  assert.deepEqual(noticeView(g!), {
    modal: "system",
    tone: "alert",
    label: "RIVAL PRESSURE",
    title: "3 RIVALS PASSED YOU",
    body: [
      "RIVAL // ASH-3 passed your MIND score.",
      "RIVAL // OAK-1 [SIM] passed your BODY score.",
      "RIVAL // ELM-2 passed your WEALTH score.",
      "The order changed overnight. It is logged.",
    ].join("\n"),
  });
});

test("a single ghost rival_passed notice carries the SIM tag", () => {
  const { notices } = parseNotices([passedN(1, "RIVAL // OAK-1", "BODY", true)]);
  assert.deepEqual(noticeView(nextNoticeGroup(notices, new Set())!), {
    modal: "system",
    tone: "alert",
    label: "RIVAL PRESSURE",
    title: "RIVAL // OAK-1 [SIM] passed your BODY score.",
    body: "The order changed overnight. It is logged.",
  });
});

test("raid_result renders as a SYSTEM modal with the dispatch line", () => {
  const line = "RAID RESULT - WEEK 44. Your clan ranked 2 of 3. Mind logs: 9. Rival clan: 12. Gap: 3.";
  const payload = { weekKey: "2026-W44", week: 44, type: "domain", position: 2, count: 3, won: false, value: 9, rivalValue: 12, bonus: 0, line };
  const notice = { id: id(80), kind: "raid_result", payload, createdAt: at() };
  const parsed = parseNotices([notice]);
  assert.equal(parsed.skipped, 0);
  assert.deepEqual(noticeView({ kind: "raid_result", notices: parsed.notices }), {
    modal: "system",
    tone: "alert",
    label: "RAID RESULT",
    title: "WEEK 44: POSITION 2 OF 3",
    body: line,
  });
});

test("named challenge and shame notices render as SYSTEM modals; shame notices share one modal", () => {
  const received = { id: id(80), kind: "challenge_received", payload: { challengeId: id(81), handle: "USER // ASH-3", domain: "MIND", days: 7 }, createdAt: at() };
  const result = (n: number, outcome: string, delta: number) => ({
    id: id(n),
    kind: "challenge_result",
    payload: { challengeId: id(81), handle: "yuri_1", domain: "BODY", days: 3, outcome, myGain: 4.25, theirGain: -1, delta },
    createdAt: at(),
  });
  const shame = (n: number, handle: string, questTitle: string) => ({ id: id(n), kind: "shame", payload: { handle, questTitle }, createdAt: at() });

  const rcv = noticeView(nextNoticeGroup(parseNotices([received]).notices, new Set())!);
  assert.deepEqual([rcv.modal, (rcv as { label: string }).label, (rcv as { title: string }).title], ["system", "CHALLENGE RECEIVED", "USER // ASH-3 challenged you."]);

  const win = noticeView(nextNoticeGroup(parseNotices([result(82, "win", 3)]).notices, new Set())!) as { label: string; body: string };
  assert.equal(win.label, "CHALLENGE WON");
  assert.equal(win.body, "BODY gain: you +4.3, yuri_1 -1.0. +3.0 DISCIPLINE. Logged.");
  const loss = noticeView(nextNoticeGroup(parseNotices([result(83, "loss", -1.5)]).notices, new Set())!) as { label: string; body: string };
  assert.equal(loss.label, "CHALLENGE LOST");
  assert.ok(loss.body.endsWith("-1.5 DISCIPLINE. Logged."));
  const draw = noticeView(nextNoticeGroup(parseNotices([result(84, "draw", 0)]).notices, new Set())!) as { label: string; body: string };
  assert.equal(draw.label, "CHALLENGE DRAWN");
  assert.ok(draw.body.endsWith("No score change. Logged."));

  const one = nextNoticeGroup(parseNotices([shame(85, "uma_1", "Run 5k")]).notices, new Set())!;
  assert.equal((noticeView(one) as { title: string }).title, "uma_1 failed to complete: Run 5k. Logged.");
  const many = nextNoticeGroup(parseNotices([shame(86, "uma_1", "Run 5k"), shame(87, "mal_1", "Read")]).notices, new Set())!;
  assert.equal(many.notices.length, 2);
  const same = nextNoticeGroup(parseNotices([shame(88, "uma_1", "Run 5k"), shame(89, "uma_1", "Read")]).notices, new Set())!;
  assert.equal((noticeView(same) as { title: string }).title, "2 FAILURES BY uma_1");
  assert.ok((rcv as { body: string }).body.includes("winner +3.0 DISCIPLINE, loser -1.5. Answer within 48 hours"));
  const m = noticeView(many) as { title: string; body: string };
  assert.equal(m.title, "2 CLANMATES FAILED");
  assert.equal(m.body, "uma_1 failed to complete: Run 5k. Logged.\nmal_1 failed to complete: Read. Logged.");
});
