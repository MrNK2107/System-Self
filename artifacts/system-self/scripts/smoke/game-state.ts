// Smoke: the calls AppContext / NoticeHost make (lib/game, lib/api outbox) against a running API.
// register + onboard -> GET /state -> enqueue a BODY log via the outbox and flush -> score/streak updated ->
// notices carry first_log, shown in order, marked seen -> not returned again -> offline (dead port) enqueue,
// quest mutation held back -> flush against the live API -> exactly one log server-side, replay deduped.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/game-state.ts
import assert from "node:assert/strict";
import { createApiClient, type ApiClient } from "../../lib/api/client";
import { createOutbox, type KeyValueStorage, type OutboxItem } from "../../lib/api/outbox";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import {
  completeQuest,
  enqueueLog,
  fetchGameState,
  fetchLogs,
  fetchNotices,
  fetchQuests,
  generateQuests,
  markNoticesSeen,
  newClientId,
} from "../../lib/game/actions";
import { mergeLogs, pendingLogEntries, toDomainScores } from "../../lib/game/mappers";
import { nextNoticeGroup, noticeView, parseNotices } from "../../lib/game/notices";
import { submitOnboarding } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams } from "../../lib/onboarding/payload";

const baseUrl = process.env.SMOKE_API_URL;
if (!baseUrl) {
  console.error("SMOKE_API_URL is required");
  process.exit(2);
}

let stored: Session | null = null;
const tokens: TokenStore = {
  get: async () => stored,
  set: async (s) => {
    stored = s;
  },
};
const clientFor = (url: string) => createApiClient({ fetch: (i, init) => fetch(i, init), tokens, baseUrl: url, onSessionExpired: () => {} });
const api = clientFor(baseUrl);
const deadApi = clientFor("http://127.0.0.1:9"); // nothing listens here: every request is a network error
const auth = createAuthActions({ api, tokens, handleSignIn: async () => {}, clearLocalData: async () => {} });

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

/** The same outbox wiring as getOutbox(), over a chosen API client. */
const outboxOver = (client: ApiClient, storage: KeyValueStorage) =>
  createOutbox({
    storage,
    getUserId: async () => stored?.user.id ?? null,
    send: async (item: OutboxItem) => {
      await client.request(item.method, item.path, { body: item.body, idempotencyKey: item.clientId });
    },
  });

const step = (name: string, detail?: unknown) => console.log(`ok  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);

async function main() {
  const suffix = Date.now().toString(36);
  const user = await auth.signUp({
    email: `smoke-game-${suffix}@example.com`,
    password: "correct horse battery",
    username: `sg_${suffix}`.slice(0, 20),
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Build an unbreakable daily routine",
      weakness: "DISCIPLINE",
      identity: "semi-public",
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${suffix}`));
  step("register + onboard", { username: user.username });

  // 1. GET /state, as the context reads it.
  const s0 = await fetchGameState(api);
  const body0 = toDomainScores(s0.scores).find((d) => d.domain === "BODY")!;
  assert.equal(toDomainScores(s0.scores).length, 5);
  step("GET /state", { BODY: body0, tierProgress: s0.tierProgress, trajectory: s0.trajectory, unseen: s0.unseenNotices.length });

  // 2. A BODY log through the outbox, then flush.
  const storage = memoryStorage();
  const outbox = outboxOver(api, storage);
  const first = await enqueueLog(outbox, { domain: "BODY", type: "workout", note: "ran 5k", intensity: 4 });
  assert.deepEqual(await outbox.flush(), { sent: 1, remaining: 0 });
  step("enqueue BODY log + flush", { clientId: first.clientId });

  // 3. The state reflects it: score up, streak 1.
  const s1 = await fetchGameState(api);
  const body1 = toDomainScores(s1.scores).find((d) => d.domain === "BODY")!;
  assert.ok(body1.score > body0.score, "BODY score went up");
  assert.equal(body1.streak, 1);
  step("state after log", { before: body0.score, after: body1.score, streak: body1.streak });

  // 4. Notices: first_log is among them; shown one group at a time in priority order, each marked seen after "dismissal".
  const { notices, skipped } = parseNotices(s1.unseenNotices);
  assert.equal(skipped, 0);
  const firstLog = notices.find((n) => n.kind === "achievement" && n.payload.id === "first_log");
  assert.ok(firstLog, "first_log achievement notice present");
  const acknowledged = new Set<string>();
  const shown: string[] = [];
  for (let g = nextNoticeGroup(notices, acknowledged); g; g = nextNoticeGroup(notices, acknowledged)) {
    const view = noticeView(g);
    shown.push(view.modal === "achievement" ? `achievement:${view.achievement.id}` : view.modal);
    const ids = g.notices.map((n) => n.id);
    ids.forEach((id) => acknowledged.add(id));
    await markNoticesSeen(api, ids, newClientId("seen"));
  }
  assert.ok(shown.includes("achievement:first_log"));
  step("notices shown in order and marked seen", shown);

  const s2 = await fetchGameState(api);
  assert.ok(!s2.unseenNotices.some((n) => (n as { id: string }).id === firstLog.id), "seen notice not in state");
  const more = await fetchNotices(api);
  assert.ok(!more.items.some((n) => (n as { id: string }).id === firstLog.id), "seen notice not in GET /notices");
  step("seen notices are not returned again", { stateUnseen: s2.unseenNotices.length, noticesPage: more.items.length });

  // 5. Offline: the log queues, shows as pending, and a quest mutation is held back behind it.
  const offlineStorage = memoryStorage();
  const offlineOutbox = outboxOver(deadApi, offlineStorage);
  const queued = await enqueueLog(offlineOutbox, { domain: "SOCIAL", type: "conversation", intensity: 3 });
  assert.deepEqual(await offlineOutbox.flush(), { sent: 0, remaining: 1 });
  const view = mergeLogs(await fetchLogs(api), pendingLogEntries(offlineOutbox.pending()));
  assert.equal(view.filter((l) => l.pending).length, 1);
  step("offline: log queued and shown as pending", { clientId: queued.clientId, logsInView: view.length });

  const board = await generateQuests(api, outbox, newClientId("gen"));
  assert.ok(board.ok);
  const quest = (await fetchQuests(api)).active[0];
  assert.ok(quest, "a generated quest to complete");
  const held = await completeQuest(api, offlineOutbox, quest.id, newClientId("cq"));
  assert.deepEqual(held, { ok: false, reason: "sync_pending" });
  step("offline: quest completion held back (Sync pending)", held);

  // 6. Back online (same stored queue, live API): the queued log lands exactly once, then the mutation goes through.
  const online = outboxOver(api, offlineStorage);
  assert.deepEqual(await online.flush(), { sent: 1, remaining: 0 });
  // The response was "lost" and the item replayed: the server dedupes by clientId.
  const replayBody = { ...(queued.body as Record<string, unknown>) };
  const replay = await api.request<{ log: { id: string } }>("POST", "/api/logs", { body: replayBody, idempotencyKey: queued.clientId });
  const logs = await fetchLogs(api);
  const matching = logs.filter((l) => l.clientId === queued.clientId);
  assert.equal(matching.length, 1, "exactly one log server-side");
  assert.equal(replay.log.id, matching[0]!.id);
  assert.equal(logs.length, 2);
  step("online: outbox flushed, exactly one log server-side (replay deduped)", { total: logs.length, clientId: queued.clientId });

  const done = await completeQuest(api, online, quest.id, newClientId("cq"));
  assert.equal(done.ok, true);
  const s3 = await fetchGameState(api);
  const social = toDomainScores(s3.scores).find((d) => d.domain === "SOCIAL")!;
  assert.equal(social.streak, 1);
  step("quest completed after the flush", { quest: quest.title, socialStreak: social.streak });

  console.log("SMOKE PASSED");
}

main().catch((e) => {
  console.error("SMOKE FAILED", e);
  process.exit(1);
});
