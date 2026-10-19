// Smoke: Party of Two against a running API.
// Two players -> a semi-public username does not resolve for an invite -> invite by public username -> the invitee sees it
// -> accept -> both see each other by username and no scores -> check-ins reach the partner (and a duo_checkin notice)
// -> the 4th GOING NOW in a day is refused (429 nudge_limit) -> a second duo is refused (409 already_in_duo)
// -> leave dissolves the duo for both.
// Registers 3 accounts (the register limiter allows 10 per 15 minutes per IP).
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/duo.ts
import assert from "node:assert/strict";
import { createApiClient, ApiError, type ApiClient } from "../../lib/api/client";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { DUO_BUTTONS, answerDuoInvite, checkinLine, fetchDuo, inviteToDuo, leaveDuo, sendDuoCheckin } from "../../lib/duo/duo";
import { fetchNotices, newClientId } from "../../lib/game/actions";
import { parseNotices } from "../../lib/game/notices";
import { submitOnboarding } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams, type IdentitySetting } from "../../lib/onboarding/payload";

const baseUrl = process.env.SMOKE_API_URL;
if (!baseUrl) {
  console.error("SMOKE_API_URL is required");
  process.exit(2);
}

const synced = { flushBeforeMutation: async () => true };
const step = (name: string, detail?: unknown) => console.log(`ok  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);

interface Player {
  api: ApiClient;
  username: string;
}

async function makePlayer(prefix: string, label: string, identity: IdentitySetting): Promise<Player> {
  let stored: Session | null = null;
  const tokens: TokenStore = { get: async () => stored, set: async (s) => void (stored = s) };
  const api = createApiClient({ fetch: (i, init) => fetch(i, init), tokens, baseUrl: baseUrl!, onSessionExpired: () => {} });
  const auth = createAuthActions({ api, tokens, handleSignIn: async () => {}, clearLocalData: async () => {} });
  const username = `${prefix}_${label}`;
  await auth.signUp({
    email: `smoke-duo-${prefix}-${label}@example.com`,
    password: "correct horse battery",
    username,
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 4, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Build a disciplined life",
      weakness: "MIND",
      identity,
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${prefix}-${label}`));
  return { api, username };
}

async function rejectedWith(run: () => Promise<unknown>, status: number, code: string) {
  try {
    await run();
  } catch (e) {
    assert.ok(e instanceof ApiError, "an ApiError was expected");
    assert.equal(e.status, status);
    assert.equal(e.code, code);
    return;
  }
  assert.fail(`expected ${status} ${code}`);
}

async function main() {
  const prefix = `sd${Date.now().toString(36).slice(-6)}`;
  const a = await makePlayer(prefix, "a", "public");
  const b = await makePlayer(prefix, "b", "public");
  const hidden = await makePlayer(prefix, "c", "semi-public");
  step("register + onboard three players", { prefix });

  await rejectedWith(() => inviteToDuo(a.api, synced, hidden.username, newClientId("d")), 404, "not_found");
  step("a semi-public username does not resolve for an invite -> 404 not_found");

  const inv = await inviteToDuo(a.api, synced, b.username, newClientId("d"));
  assert.ok(inv.ok);
  assert.equal(inv.value.direction, "outgoing");
  const incoming = (await fetchDuo(b.api)).pendingInvites;
  assert.deepEqual(incoming.map((i) => [i.id, i.direction]), [[inv.value.id, "incoming"]]);
  step("invite by public username; the invitee sees it", { handle: incoming[0]!.handle });

  const accepted = await answerDuoInvite(b.api, synced, inv.value.id, "accept", newClientId("d"));
  assert.ok(accepted.ok);
  assert.equal(accepted.value.partner?.handle, a.username);
  const viewA = await fetchDuo(a.api);
  assert.equal(viewA.partner?.handle, b.username);
  for (const v of [viewA, accepted.value]) {
    assert.equal(v.partner?.scores, undefined);
    assert.ok(!/hidden|userId/i.test(JSON.stringify(v)));
  }
  step("accept forms a duo; both see usernames and no scores");

  for (const button of DUO_BUTTONS.filter((x) => x.kind !== "going_now")) {
    const r = await sendDuoCheckin(a.api, synced, button.kind, newClientId("ck"));
    assert.ok(r.ok);
  }
  const seenByB = await fetchDuo(b.api);
  assert.deepEqual(seenByB.checkins.map((c) => [c.kind, c.fromMe]).sort(), [["checked_in", false], ["done", false]]);
  step("check-ins reach the partner", { lines: seenByB.checkins.map((c) => checkinLine(c, a.username, new Date())) });

  const unseen = parseNotices((await fetchNotices(b.api)).items).notices.filter((n) => n.kind === "duo_checkin");
  assert.equal(unseen.length, 2);
  step("the partner gets duo_checkin notices through the kinds filter", { count: unseen.length });

  for (let i = 0; i < 3; i++) assert.ok((await sendDuoCheckin(a.api, synced, "going_now", newClientId("n"))).ok);
  await rejectedWith(() => sendDuoCheckin(a.api, synced, "going_now", newClientId("n")), 429, "nudge_limit");
  step("the 4th GOING NOW of the day -> 429 nudge_limit");

  const third = await makePlayer(prefix, "d", "public");
  await rejectedWith(() => inviteToDuo(third.api, synced, a.username, newClientId("d")), 409, "unavailable");
  step("a second duo is refused -> 409 already_in_duo");

  assert.ok((await leaveDuo(b.api, synced, newClientId("l"))).ok);
  for (const p of [a, b]) {
    const v = await fetchDuo(p.api);
    assert.deepEqual([v.partner, v.checkins], [null, []]);
  }
  step("leave dissolves the duo for both");

  console.log("smoke: duo OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
