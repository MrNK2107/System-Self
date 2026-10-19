import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createApiClient } from "../api/client";
import type { Session, TokenStore } from "../api/session";
import { createSettingsActions, describeSettingsError, validatePasswordChange } from "./actions";

const user = {
  id: "u1",
  email: "a@b.co",
  username: "alpha",
  role: "user" as const,
  emailVerified: false,
  timezone: "UTC",
  createdAt: "2026-01-01T00:00:00.000Z",
};
const session: Session = { user, accessToken: "at", accessTokenExpiresAt: "2030-01-01T00:00:00.000Z", refreshToken: "rt" };

type Call = { method: string; url: string; body: unknown };

function setup(handler: (call: Call) => { status: number; body?: unknown }) {
  let stored: Session | null = session;
  const tokens: TokenStore = { get: async () => stored, set: async (s) => void (stored = s) };
  const calls: Call[] = [];
  const events: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const call: Call = { method: String(init?.method), url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const r = handler(call);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  };
  const api = createApiClient({ fetch: fakeFetch, tokens, baseUrl: "http://x", onSessionExpired: () => {} });
  const actions = createSettingsActions({
    api,
    tokens,
    clearLocalData: async (id) => void events.push(`clear:${id}:${stored === null ? "no-session" : "session"}`),
  });
  return { actions, calls, events, stored: () => stored };
}

const profileBody = {
  username: "alpha",
  codename: "ALPHA",
  publicCodename: "USER // ASH-1",
  rank: "E",
  rankSince: "2026-01-01T00:00:00.000Z",
  identitySetting: "public",
  primaryGoal: "Build a routine",
  biggestWeakness: "DISCIPLINE",
  morningTime: "06:00",
  nightlyTime: "22:00",
  dayNumber: 1,
  onboarded: true,
  homePathActive: false,
  lifeContext: "student",
  season: null,
};

test("requestEmailVerification posts to the request endpoint", async () => {
  const t = setup(() => ({ status: 204 }));
  await t.actions.requestEmailVerification();
  assert.equal(t.calls[0]!.url, "http://x/api/auth/email/verify/request");
  assert.equal(t.calls[0]!.method, "POST");
});

test("verifyEmail trims the code and stores the verified user on the session", async () => {
  const t = setup(() => ({ status: 200, body: { user: { ...user, emailVerified: true } } }));
  const u = await t.actions.verifyEmail(" 123456 ");
  assert.deepEqual(t.calls[0]!.body, { code: "123456" });
  assert.equal(u.emailVerified, true);
  assert.equal(t.stored()?.user.emailVerified, true);
  assert.equal(t.stored()?.accessToken, "at");
});

test("changePassword stores the fresh session the server returns", async () => {
  const fresh: Session = { ...session, accessToken: "at2", refreshToken: "rt2" };
  const t = setup(() => ({ status: 200, body: fresh }));
  await t.actions.changePassword("old-password-1", "new-password-1");
  assert.deepEqual(t.calls[0]!.body, { currentPassword: "old-password-1", newPassword: "new-password-1" });
  assert.equal(t.stored()?.accessToken, "at2");
  assert.equal(t.stored()?.refreshToken, "rt2");
});

test("changePassword with a wrong current password keeps the old session", async () => {
  const t = setup(() => ({ status: 401, body: { error: "Invalid password", code: "invalid_password" } }));
  await assert.rejects(t.actions.changePassword("nope-nope-1", "new-password-1"), (e) => {
    assert.equal(describeSettingsError(e, "password").message, "That password is incorrect.");
    return true;
  });
  assert.equal(t.stored()?.accessToken, "at");
  assert.equal(t.calls.length, 1); // an endpoint-coded 401 is not an expired token: no refresh
});

test("deleteAccount sends the password, wipes local data for that user while the session exists, then clears it", async () => {
  const t = setup(() => ({ status: 204 }));
  await t.actions.deleteAccount("right-password-1");
  assert.equal(t.calls[0]!.method, "DELETE");
  assert.equal(t.calls[0]!.url, "http://x/api/auth/account");
  assert.deepEqual(t.calls[0]!.body, { password: "right-password-1" });
  assert.deepEqual(t.events, ["clear:u1:session"]);
  assert.equal(t.stored(), null);
});

test("deleteAccount with a wrong password changes nothing locally", async () => {
  const t = setup(() => ({ status: 401, body: { error: "Invalid password", code: "invalid_password" } }));
  await assert.rejects(t.actions.deleteAccount("wrong"), (e) => {
    assert.equal(describeSettingsError(e, "delete").message, "That password is incorrect.");
    return true;
  });
  assert.deepEqual(t.events, []);
  assert.equal(t.stored()?.accessToken, "at");
});

test("deleteAccount clears the session even when the local wipe throws", async () => {
  let stored: Session | null = session;
  const tokens: TokenStore = { get: async () => stored, set: async (s) => void (stored = s) };
  const api = createApiClient({
    fetch: async () => new Response(null, { status: 204 }),
    tokens,
    baseUrl: "http://x",
    onSessionExpired: () => {},
  });
  const actions = createSettingsActions({
    api,
    tokens,
    clearLocalData: async () => {
      throw new Error("disk full");
    },
  });
  await assert.rejects(actions.deleteAccount("pw-pw-pw-pw"), /disk full/);
  assert.equal(stored, null);
});

test("updateSchedule and updateIdentity patch only their fields and parse the profile", async () => {
  const t = setup(() => ({ status: 200, body: profileBody }));
  const p = await t.actions.updateSchedule({ morningTime: "06:00", nightlyTime: "22:00" });
  assert.equal(p.morningTime, "06:00");
  assert.deepEqual(t.calls[0]!.body, { morningTime: "06:00", nightlyTime: "22:00" });
  assert.equal(t.calls[0]!.method, "PATCH");
  await t.actions.updateIdentity("anonymous");
  assert.deepEqual(t.calls[1]!.body, { identitySetting: "anonymous" });
  assert.equal(t.calls[1]!.url, "http://x/api/profile");
});

test("verification and password errors read in plain copy", () => {
  const http = (status: number, code?: string) => new ApiError({ kind: "http", status, code, message: "x" });
  assert.equal(describeSettingsError(http(400, "invalid_code"), "verify").message, "That code is incorrect.");
  assert.equal(describeSettingsError(http(400, "expired_code"), "verify").message, "That code has expired. Request a new one.");
  assert.equal(describeSettingsError(http(400, "locked"), "verify").message, "Too many wrong codes. Request a new one.");
  assert.equal(describeSettingsError(http(429, "code_rate_limited"), "verify-request").message, "Too many codes requested. Try again later.");
  assert.equal(describeSettingsError(new ApiError({ kind: "network", message: "x" }), "password").message, "No connection. Check your signal and retry.");
  assert.equal(describeSettingsError(http(503), "schedule").message, "The system is unavailable. Retry shortly.");
});

test("validatePasswordChange", () => {
  assert.equal(validatePasswordChange("", "new-password-1"), "Enter your current password.");
  assert.equal(validatePasswordChange("old", "short"), "Use at least 10 characters.");
  assert.equal(validatePasswordChange("same-password-1", "same-password-1"), "Choose a different password.");
  assert.equal(validatePasswordChange("old", "new-password-1"), null);
});
