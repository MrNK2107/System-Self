// Smoke: drives the calls the settings screens make (lib/settings, lib/auth) against a running API.
// register + onboard -> PATCH profile times -> GET /state reflects them -> identity -> request a verify code ->
// read it from the API log -> verify -> /me emailVerified -> change password (old access token rejected, new
// session works) -> delete with a wrong password (401) -> delete with the right one (204) -> login fails.
// Usage: SMOKE_API_URL=http://localhost:3001 SMOKE_API_LOG=<api stdout log file> pnpm exec tsx scripts/smoke/settings.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GameStateSchema } from "@workspace/contracts";
import { ApiError, createApiClient } from "../../lib/api/client";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions } from "../../lib/auth/actions";
import { submitOnboarding } from "../../lib/onboarding/actions";
import { buildOnboardingPayload, draftFromParams } from "../../lib/onboarding/payload";
import { createSettingsActions, describeSettingsError } from "../../lib/settings/actions";

const baseUrl = process.env.SMOKE_API_URL;
const logFile = process.env.SMOKE_API_LOG;
if (!baseUrl || !logFile) {
  console.error("SMOKE_API_URL and SMOKE_API_LOG are required");
  process.exit(2);
}

let stored: Session | null = null;
const tokens: TokenStore = {
  get: async () => stored,
  set: async (s) => {
    stored = s;
  },
};
const events: string[] = [];
const api = createApiClient({ fetch: (i, init) => fetch(i, init), tokens, baseUrl, onSessionExpired: () => {} });
const clearLocalData = async (userId?: string) => void events.push(`clearLocalData:${userId}`);
const auth = createAuthActions({ api, tokens, handleSignIn: async () => {}, clearLocalData });
const settings = createSettingsActions({ api, tokens, clearLocalData });

const step = (name: string, detail?: unknown) => console.log(`ok  ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);

async function expectHttp(p: Promise<unknown>, status: number, code?: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ApiError, `ApiError expected, got ${String(e)}`);
    assert.equal(e.kind, "http");
    assert.equal(e.status, status);
    if (code) assert.equal(e.code, code);
    return true;
  });
}

/** The newest "Your verification code is NNNNNN" line in the API log. */
function latestVerifyCode(): string {
  const text = readFileSync(logFile!, "utf8");
  const all = [...text.matchAll(/Your verification code is (\d+)/g)];
  assert.ok(all.length > 0, "no verification code in the API log");
  return all[all.length - 1]![1]!;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const suffix = Date.now().toString(36);
  const email = `smoke-set-${suffix}@example.com`;
  const password = "correct horse battery";

  // 1. Register + onboard.
  const user = await auth.signUp({
    email,
    password,
    username: `set_${suffix}`.slice(0, 20),
    birthYear: 1990,
    acceptTerms: true,
    timezone: "UTC",
  });
  assert.equal(user.emailVerified, false);
  const draft = draftFromParams(
    {
      ratings: JSON.stringify({ BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 8, DISCIPLINE: 3 }),
      primaryGoal: "Build an unbreakable daily routine",
      weakness: "DISCIPLINE",
      stoppedBefore: "I quit the moment I miss one day",
      identity: "semi-public",
    },
    "UTC",
  );
  assert.ok(draft);
  await submitOnboarding(api, buildOnboardingPayload(draft, `smoke-set-${suffix}`));
  step("register + onboard", { username: user.username, emailVerified: user.emailVerified });

  // 2. Schedule: PATCH then GET /state reflects it.
  const profile = await settings.updateSchedule({ morningTime: "05:30", nightlyTime: "22:30" });
  assert.equal(profile.morningTime, "05:30");
  const state = await api.request("GET", "/api/state", { schema: GameStateSchema });
  assert.equal(state.profile.morningTime, "05:30");
  assert.equal(state.profile.nightlyTime, "22:30");
  step("PATCH /profile schedule, GET /state reflects", { morningTime: state.profile.morningTime, nightlyTime: state.profile.nightlyTime });

  // 3. Identity visibility.
  const ident = await settings.updateIdentity("anonymous");
  assert.equal(ident.identitySetting, "anonymous");
  assert.equal(ident.morningTime, "05:30"); // untouched
  assert.equal((await api.request("GET", "/api/state", { schema: GameStateSchema })).profile.identitySetting, "anonymous");
  step("PATCH /profile identity", { identitySetting: ident.identitySetting });

  // 4. Email verification: wrong code, then the real one from the API log.
  await settings.requestEmailVerification();
  let code = "";
  for (let i = 0; i < 20 && !code; i++) {
    try {
      code = latestVerifyCode();
    } catch {
      await sleep(250);
    }
  }
  assert.ok(code, "verification code never appeared in the API log");
  await assert.rejects(settings.verifyEmail(code === "000000" ? "111111" : "000000"), (e: unknown) => {
    assert.equal(describeSettingsError(e, "verify").message, "That code is incorrect.");
    return true;
  });
  step("wrong code rejected", { message: "That code is incorrect." });
  const verified = await settings.verifyEmail(code);
  assert.equal(verified.emailVerified, true);
  const me = await auth.fetchMe();
  assert.equal(me.emailVerified, true);
  assert.equal(stored?.user.emailVerified, true);
  step("verify email, /me emailVerified", { emailVerified: me.emailVerified });

  // 5. Change password: wrong current password is refused and keeps the session; the right one rotates it.
  const oldAccess = stored!.accessToken;
  const oldRefresh = stored!.refreshToken;
  const newPassword = "a brand new passphrase";
  await assert.rejects(settings.changePassword("wrong password here", newPassword), (e: unknown) => {
    assert.equal(describeSettingsError(e, "password").message, "That password is incorrect.");
    return true;
  });
  assert.equal(stored!.accessToken, oldAccess);
  await settings.changePassword(password, newPassword);
  assert.notEqual(stored!.accessToken, oldAccess);
  const staleRes = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${oldAccess}` } });
  assert.equal(staleRes.status, 401);
  const staleRefresh = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: oldRefresh }),
  });
  assert.equal(staleRefresh.status, 401);
  assert.equal((await auth.fetchMe()).email, email);
  step("change password: old access + refresh rejected, new session works", { oldAccess: staleRes.status, oldRefresh: staleRefresh.status });

  // 6. Delete account: wrong password 401 (session untouched), right password 204.
  const before = stored!.accessToken;
  await expectHttp(settings.deleteAccount("not my password"), 401, "invalid_password");
  assert.equal(stored!.accessToken, before);
  assert.deepEqual(events, []);
  assert.equal((await auth.fetchMe()).email, email);
  step("delete with wrong password -> 401, session kept");

  await settings.deleteAccount(newPassword);
  assert.equal(stored, null);
  assert.deepEqual(events, [`clearLocalData:${user.id}`]);
  step("delete with right password -> 204, local wipe for that user, session cleared", { events });

  // 7. The deleted credentials no longer work (old and new password).
  await expectHttp(auth.signIn(email, newPassword), 401);
  await expectHttp(auth.signIn(email, password), 401);
  step("login with deleted credentials fails -> 401");

  console.log("SMOKE PASSED");
}

main().catch((e) => {
  console.error("SMOKE FAILED", e);
  process.exit(1);
});
