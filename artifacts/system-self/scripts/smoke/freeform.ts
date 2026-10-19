// Smoke: free-form logging against a running API (no Gemini key: the engine keyword parser answers).
// Register + onboard -> parse "slept 6 hours and read 30 pages" into 2 proposals -> nothing is logged yet -> post one
// confirmed proposal the way the outbox does (with the original text as freeText) -> the log exists with freeText ->
// a voice upload as a free user is refused with the PRO lock's 402. Registers 1 account.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/freeform.ts
import assert from "node:assert/strict";
import { createApiClient } from "../../lib/api/client";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { buildLogRequest, fetchLogs, newClientId } from "../../lib/game/actions";
import { isProRequired, parseText, proposalSummary, proposalToLogInput, sendVoice } from "../../lib/freeform/freeform";
import { submitOnboarding } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams } from "../../lib/onboarding/payload";

const baseUrl = process.env.SMOKE_API_URL;
if (!baseUrl) {
  console.error("SMOKE_API_URL is required");
  process.exit(2);
}

const step = (name: string, detail?: unknown) => console.log(`ok  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);

async function main() {
  const prefix = `ff${Date.now().toString(36).slice(-6)}`;
  let stored: Session | null = null;
  const tokens: TokenStore = { get: async () => stored, set: async (s) => void (stored = s) };
  const api = createApiClient({ fetch: (i, init) => fetch(i, init), tokens, baseUrl: baseUrl!, onSessionExpired: () => {} });
  const auth = createAuthActions({ api, tokens, handleSignIn: async () => {}, clearLocalData: async () => {} });
  await auth.signUp({
    email: `smoke-freeform-${prefix}@example.com`,
    password: "correct horse battery",
    username: `${prefix}_x`,
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 4, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 }),
      primaryGoal: "Build a disciplined life",
      weakness: "BODY",
      identity: "anonymous",
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-onb-${prefix}`));
  step("register + onboard", { prefix });

  const text = "slept 6 hours and read 30 pages";
  const proposals = await parseText(api, text);
  assert.deepEqual(proposals.map((p) => p.logType), ["sleep", "reading"]);
  step("parsed into proposals", proposals.map(proposalSummary));

  assert.equal((await fetchLogs(api)).length, 0);
  step("parse wrote nothing");

  const entry = buildLogRequest(proposalToLogInput(proposals[0]!, text), newClientId("ff"));
  await api.request(entry.method, entry.path, { body: entry.body });
  const logs = await fetchLogs(api);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]!.logType, "sleep");
  assert.equal(logs[0]!.freeText, text);
  step("confirmed proposal logged with freeText", { logType: logs[0]!.logType, freeText: logs[0]!.freeText });

  await assert.rejects(sendVoice(api, new Uint8Array([1, 2, 3]).buffer), (err) => isProRequired(err));
  step("voice as a free user: 402 pro_required");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
