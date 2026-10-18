// Smoke: SYSTEM messages, the nightly debrief, the weekly recap and the completion summary against a running API
// in template mode (no GEMINI_API_KEY). register + onboard -> morning_briefing twice (same text) -> debrief/today
// unavailable -> PATCH /api/profile nightlyTime to a past local time -> debrief/today available with a verdict ->
// ack -> recap weekly + weekly debrief -> completions summary.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/messages.ts
import assert from "node:assert/strict";
import { createApiClient } from "../../lib/api/client";
import { createOutbox, type KeyValueStorage, type OutboxItem } from "../../lib/api/outbox";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import {
  ackDebrief,
  fetchCompletionSummary,
  fetchDebriefToday,
  fetchMessage,
  fetchWeeklyDebrief,
  fetchWeeklyRecap,
  tryFetchMessage,
} from "../../lib/game/messages";
import { submitOnboarding, updateSchedule } from "../../lib/onboarding/actions";
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
const api = createApiClient({ fetch: (i, init) => fetch(i, init), tokens, baseUrl, onSessionExpired: () => {} });
const auth = createAuthActions({ api, tokens, handleSignIn: async () => {}, clearLocalData: async () => {} });

const memoryStorage = (): KeyValueStorage => {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
};
const outbox = createOutbox({
  storage: memoryStorage(),
  getUserId: async () => stored?.user.id ?? null,
  send: async (item: OutboxItem) => {
    await api.request(item.method, item.path, { body: item.body, idempotencyKey: item.clientId });
  },
});

const step = (name: string, detail?: unknown) => console.log(`ok  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);

async function main() {
  const suffix = Date.now().toString(36);
  await auth.signUp({
    email: `smoke-messages-${suffix}@example.com`,
    password: "correct horse battery",
    username: `sm_${suffix}`.slice(0, 20),
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
  step("register + onboard");

  const first = await tryFetchMessage(api, "morning_briefing");
  const second = await tryFetchMessage(api, "morning_briefing");
  assert.ok(first && first.length > 0, "briefing text");
  assert.equal(second, first, "morning_briefing is cached per day");
  step("morning_briefing twice, same text", { text: first });

  const shadow = await fetchMessage(api, "shadow_confrontation");
  assert.ok(shadow.length > 0);
  step("shadow_confrontation", { text: shadow });

  // Make sure the debrief is closed first: nightlyTime is 21:00 by default; skip the assertion when it is already past in UTC.
  const closed = await fetchDebriefToday(api);
  if (!closed.available) step("debrief/today unavailable", { availableAt: closed.availableAt });
  else step("debrief/today already open (default nightlyTime is past in UTC now)");

  if (!closed.available) {
    const gated = await tryFetchMessage(api, "nightly_debrief");
    assert.equal(gated, null, "nightly_debrief is 409 debrief_unavailable before nightlyTime");
    const fb = await fetchMessage(api, "nightly_debrief");
    assert.ok(fb.length > 0);
    step("POST /messages nightly_debrief before nightlyTime -> quiet fallback");
  }

  // A past local time (UTC account): one hour ago, but not across midnight.
  const now = new Date();
  const hour = Math.max(0, now.getUTCHours() - 1);
  const nightlyTime = `${String(hour).padStart(2, "0")}:00`;
  await updateSchedule(api, { morningTime: "00:00", nightlyTime });
  step("PATCH /api/profile", { nightlyTime });

  const open = await fetchDebriefToday(api);
  assert.ok(open.available, "debrief opens once nightlyTime has passed");
  assert.ok(["ACCEPTABLE", "INSUFFICIENT", "PATHETIC"].includes(open.debrief.verdict));
  assert.equal(open.debrief.acknowledged, false);
  step("debrief/today available", { verdict: open.debrief.verdict, date: open.debrief.date, text: open.debrief.text });

  const viaMessages = await tryFetchMessage(api, "nightly_debrief");
  assert.equal(viaMessages, open.debrief.text, "POST /messages nightly_debrief agrees with GET /debrief/today");
  step("POST /messages nightly_debrief matches the debrief text");

  const ack = await ackDebrief(api, outbox, open.debrief.date, `smoke-ack-${suffix}`);
  assert.equal(ack.ok, true);
  const after = await fetchDebriefToday(api);
  assert.ok(after.available && after.debrief.acknowledged, "acknowledged");
  step("ack -> acknowledged true");

  const recap = await fetchWeeklyRecap(api);
  step("recap/weekly", recap);
  const weekly = await fetchWeeklyDebrief(api);
  assert.ok(weekly.debrief.length > 0);
  step("recap/weekly/debrief", { weekStart: weekly.weekStart, debrief: weekly.debrief });

  const summary = await fetchCompletionSummary(api, 14);
  assert.equal(summary.windowDays, 14);
  step("completions/summary", { attempts: summary.attempts, completed: summary.completed, completionRate: summary.completionRate });

  console.log("SMOKE PASS");
}

main().catch((err) => {
  console.error("SMOKE FAIL", err);
  process.exit(1);
});
