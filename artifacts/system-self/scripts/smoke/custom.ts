// Smoke: CUSTOM domains against a running API.
// Register + onboard -> create 3 custom stats -> the 4th is 402 pro_required (the PRO lock) -> log a value (built by
// the app's own request builder, sent as the outbox would) -> the score is 52.5 and the streak 1 -> the ranked
// scores in GET /api/state did not move -> archive one and the 4th fits.
// Registers 1 account.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/custom.ts
import assert from "node:assert/strict";
import { CustomLogResponseSchema } from "@workspace/contracts";
import { createApiClient, ApiError } from "../../lib/api/client";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import {
  archiveCustomDomain,
  buildCustomLogRequest,
  createCustomDomain,
  customLimitLine,
  describeCustomError,
  fetchCustomDomain,
  fetchCustomDomains,
  isProRequired,
} from "../../lib/custom/custom";
import { fetchGameState, newClientId } from "../../lib/game/actions";
import { submitOnboarding } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams } from "../../lib/onboarding/payload";

const baseUrl = process.env.SMOKE_API_URL;
if (!baseUrl) {
  console.error("SMOKE_API_URL is required");
  process.exit(2);
}

const synced = { flushBeforeMutation: async () => true };
const step = (name: string, detail?: unknown) => console.log(`ok  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);
const input = (name: string) => ({ name, unit: "min", logLabel: "Log", baseline: 0, target: 60, isPublic: false });

async function main() {
  const prefix = `sc${Date.now().toString(36).slice(-6)}`;
  let stored: Session | null = null;
  const tokens: TokenStore = { get: async () => stored, set: async (s) => void (stored = s) };
  const api = createApiClient({ fetch: (i, init) => fetch(i, init), tokens, baseUrl: baseUrl!, onSessionExpired: () => {} });
  const auth = createAuthActions({ api, tokens, handleSignIn: async () => {}, clearLocalData: async () => {} });
  await auth.signUp({
    email: `smoke-custom-${prefix}@example.com`,
    password: "correct horse battery",
    username: `${prefix}_c`,
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 4, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Build a disciplined life",
      weakness: "SOCIAL",
      identity: "anonymous",
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${prefix}`));
  step("register + onboard", { prefix });

  const before = (await fetchGameState(api)).scores;

  const made = [];
  for (const name of ["Language", "Cold", "Words"]) {
    const r = await createCustomDomain(api, synced, input(name), newClientId("custom-new"));
    assert.ok(r.ok);
    made.push(r.value.domain);
  }
  const list = await fetchCustomDomains(api);
  assert.equal(list.items.length, 3);
  assert.deepEqual(customLimitLine(list), { line: "3 of 3 custom domains.", canCreate: false, proHint: true });
  step("created 3 custom stats", customLimitLine(list));

  const fourth = await createCustomDomain(api, synced, input("Fourth"), newClientId("custom-new")).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(fourth instanceof ApiError && fourth.status === 402 && isProRequired(fourth));
  step("the 4th is PRO-locked", { line: describeCustomError(fourth) });

  const entry = buildCustomLogRequest(made[0]!.id, { value: 15, note: "smoke" }, newClientId("custom-log"));
  const res = CustomLogResponseSchema.parse(await api.request(entry.method, entry.path, { body: entry.body, idempotencyKey: entry.clientId }));
  assert.deepEqual(res, { score: 52.5, streak: 1 });
  const again = await api.request(entry.method, entry.path, { body: entry.body, idempotencyKey: entry.clientId });
  assert.deepEqual(again, res);
  step("logged a value", res);

  const detail = await fetchCustomDomain(api, made[0]!.id);
  assert.equal(detail.domain.latestValue, 15);
  assert.equal(detail.logs.length, 1);
  assert.equal(detail.logs[0]!.note, "smoke");
  step("the stat shows its entry", { latestValue: detail.domain.latestValue });

  const after = (await fetchGameState(api)).scores;
  assert.deepEqual(after, before);
  step("ranked scores unchanged");

  const archived = await archiveCustomDomain(api, synced, made[1]!.id, newClientId("custom-archive"));
  assert.ok(archived.ok && archived.value.domain.archived);
  const fits = await createCustomDomain(api, synced, input("Fourth"), newClientId("custom-new"));
  assert.ok(fits.ok);
  step("archiving makes room");
  console.log("PASS custom");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
