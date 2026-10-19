import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createApiClient } from "../api/client";
import type { Session, TokenStore } from "../api/session";
import {
  createAuthActions,
  describeAuthError,
  fetchOnboardingStatus,
  validateSignUp,
  type SignUpInput,
} from "./actions";

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

type Call = { method: string; url: string; body: unknown; auth: string | null };

function setup(
  handler: (call: Call) => { status: number; body?: unknown },
  initial: Session | null = null,
  extra: { unregisterDevice?: () => Promise<void> } = {},
) {
  let stored: Session | null = initial;
  const tokens: TokenStore = { get: async () => stored, set: async (s) => void (stored = s) };
  const calls: Call[] = [];
  const events: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const call: Call = {
      method: String(init?.method),
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: ((init?.headers as Record<string, string>) ?? {}).Authorization ?? null,
    };
    calls.push(call);
    const r = handler(call);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  };
  const api = createApiClient({ fetch: fakeFetch, tokens, baseUrl: "http://x", onSessionExpired: () => {} });
  const actions = createAuthActions({
    api,
    tokens,
    handleSignIn: async (id) => void events.push(`handleSignIn:${id}:${stored === null ? "no-session" : "session"}`),
    clearLocalData: async (userId) => void events.push(`clear:${stored === null ? "no-session" : "session"}:${userId ?? "none"}`),
    ...extra,
  });
  return { actions, api, calls, events, stored: () => stored };
}

const input: SignUpInput = {
  email: "  A@B.co ",
  password: "correct-horse",
  username: "Alpha",
  birthYear: 1990,
  acceptTerms: true,
  timezone: "Europe/London",
};

test("signUp normalises input and runs handleSignIn before storing the session", async () => {
  const t = setup(() => ({ status: 201, body: session }));
  await t.actions.signUp(input);
  assert.deepEqual(t.calls[0]!.body, {
    email: "a@b.co",
    password: "correct-horse",
    username: "alpha",
    birthYear: 1990,
    acceptTerms: true,
    timezone: "Europe/London",
  });
  assert.equal(t.calls[0]!.auth, null);
  assert.deepEqual(t.events, ["handleSignIn:u1:no-session"]);
  assert.equal(t.stored()?.accessToken, "at");
});

test("signIn failure stores nothing; 401 maps to the invalid-credentials copy", async () => {
  const t = setup(() => ({ status: 401, body: { error: "Invalid email or password" } }));
  await assert.rejects(t.actions.signIn("a@b.co", "nope"), (e) => {
    assert.equal(describeAuthError(e, "sign_in").message, "Invalid email or password.");
    return true;
  });
  assert.equal(t.stored(), null);
  assert.deepEqual(t.events, []);
});

test("signOut calls logout, clears local data while the session still exists, then clears the session", async () => {
  const t = setup(() => ({ status: 204 }), session);
  await t.actions.signOut();
  assert.equal(t.calls[0]!.url, "http://x/api/auth/logout");
  assert.deepEqual(t.calls[0]!.body, { refreshToken: "rt" });
  assert.deepEqual(t.events, ["clear:session:u1"]);
  assert.equal(t.stored(), null);
});

test("signOut still wipes everything when the logout request fails", async () => {
  const t = setup(() => ({ status: 503 }), session);
  await t.actions.signOut();
  assert.deepEqual(t.events, ["clear:session:u1"]);
  assert.equal(t.stored(), null);
});

test("signOut removes this device's push token first, while the session still exists", async () => {
  const order: string[] = [];
  const t = setup(
    (c) => {
      order.push(`http:${c.url}`);
      return { status: 204 };
    },
    session,
    { unregisterDevice: async () => void order.push("unregister") },
  );
  await t.actions.signOut();
  assert.deepEqual(order, ["unregister", "http:http://x/api/auth/logout"]);
  assert.deepEqual(t.events, ["clear:session:u1"]);
  assert.equal(t.stored(), null);
});

test("signOut still completes when removing the push token fails", async () => {
  const t = setup(() => ({ status: 204 }), session, {
    unregisterDevice: async () => {
      throw new Error("offline");
    },
  });
  await t.actions.signOut();
  assert.equal(t.calls[0]!.url, "http://x/api/auth/logout");
  assert.deepEqual(t.events, ["clear:session:u1"]);
  assert.equal(t.stored(), null);
});

test("password reset sends normalised email and trimmed code", async () => {
  const t = setup(() => ({ status: 204 }));
  await t.actions.requestPasswordReset(" A@B.co");
  await t.actions.resetPassword("A@B.co", " 123456 ", "new-password-1");
  assert.deepEqual(
    t.calls.map((c) => c.body),
    [
      { email: "a@b.co" },
      { email: "a@b.co", code: "123456", newPassword: "new-password-1" },
    ],
  );
});

test("fetchOnboardingStatus maps 404 not_onboarded and rethrows everything else", async () => {
  const notOnboarded = setup(() => ({ status: 404, body: { error: "Not onboarded", code: "not_onboarded" } }), session);
  assert.equal(await fetchOnboardingStatus(notOnboarded.api), "not_onboarded");
  const ok = setup(() => ({ status: 200, body: {} }), session);
  assert.equal(await fetchOnboardingStatus(ok.api), "onboarded");
  const down = setup(() => ({ status: 503, body: {} }), session);
  await assert.rejects(fetchOnboardingStatus(down.api), ApiError);
});

test("auth errors map to inline messages", () => {
  const taken = (code: string) => new ApiError({ kind: "http", status: 409, code, message: "x" });
  assert.deepEqual(describeAuthError(taken("email_taken"), "sign_up"), {
    message: "That email is already registered.",
    field: "email",
  });
  assert.deepEqual(describeAuthError(taken("username_taken"), "sign_up"), {
    message: "That codename is taken.",
    field: "username",
  });
  assert.equal(
    describeAuthError(new ApiError({ kind: "network", message: "n" }), "sign_in").message,
    "No connection. Check your signal and retry.",
  );
  assert.equal(
    describeAuthError(new ApiError({ kind: "http", status: 429, message: "n" }), "sign_in").message,
    "Too many attempts. Wait a moment, then retry.",
  );
  assert.equal(
    describeAuthError(new ApiError({ kind: "http", status: 400, code: "expired_code", message: "n" }), "reset").message,
    "That code has expired. Request a new one.",
  );
});

test("validateSignUp enforces the server rules", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const good = { email: "a@b.co", password: "0123456789", username: "alpha_1", birthYear: "1990", acceptTerms: true };
  assert.deepEqual(validateSignUp(good, now), {});
  assert.ok(validateSignUp({ ...good, password: "short" }, now).password);
  assert.ok(validateSignUp({ ...good, username: "Al" }, now).username);
  assert.ok(validateSignUp({ ...good, username: "bad name" }, now).username);
  assert.equal(validateSignUp({ ...good, birthYear: "2015" }, now).birthYear, "You must be 16 or older.");
  assert.ok(validateSignUp({ ...good, birthYear: "99" }, now).birthYear);
  assert.ok(validateSignUp({ ...good, acceptTerms: false }, now).acceptTerms);
  assert.deepEqual(validateSignUp({ ...good, username: "ALPHA" }, now), {});
});
