import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createApiClient } from "../api/client";
import type { Session, TokenStore } from "../api/session";
import { createAuthActions, describeAuthError, rejectsOnlyTimezone, validateSignUp, type SignUpInput } from "./actions";

const user = { id: "u1", email: "a@b.co", username: "alpha", role: "user" as const, emailVerified: false, timezone: "UTC", createdAt: "2026-01-01T00:00:00.000Z" };
const session: Session = { user, accessToken: "at", accessTokenExpiresAt: "2030-01-01T00:00:00.000Z", refreshToken: "rt" };
const input: SignUpInput = { email: "a@b.co", password: "correct horse battery", username: "alpha", birthYear: 1990, acceptTerms: true, timezone: "Mars/Olympus" };

function setup(handler: (body: Record<string, unknown> | undefined) => { status: number; body?: unknown }, clear: () => Promise<void> = async () => {}) {
  let stored: Session | null = session;
  const tokens: TokenStore = { get: async () => stored, set: async (s) => void (stored = s) };
  const bodies: Array<Record<string, unknown> | undefined> = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    bodies.push(body);
    const r = handler(body);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  };
  const api = createApiClient({ fetch: fakeFetch, tokens, baseUrl: "http://x", onSessionExpired: () => {} });
  const actions = createAuthActions({ api, tokens, handleSignIn: async () => {}, clearLocalData: clear });
  return { actions, bodies, stored: () => stored };
}

const tzIssue = { status: 400, body: { error: "Validation failed", issues: [{ path: "timezone", message: "Unknown timezone" }] } };

test("signUp retries once without timezone when only the timezone is rejected", async () => {
  const h = setup((body) => (body?.timezone ? tzIssue : { status: 201, body: session }));
  const u = await h.actions.signUp(input);
  assert.equal(u.id, "u1");
  assert.equal(h.bodies.length, 2);
  assert.equal(h.bodies[0]!.timezone, "Mars/Olympus");
  assert.equal("timezone" in h.bodies[1]!, false);
});

test("signUp does not retry when other fields are rejected too, or on other failures", async () => {
  const both = setup(() => ({ status: 400, body: { issues: [{ path: "timezone", message: "a" }, { path: "email", message: "b" }] } }));
  await assert.rejects(both.actions.signUp(input), ApiError);
  assert.equal(both.bodies.length, 1);
  const taken = setup(() => ({ status: 409, body: { error: "x", code: "email_taken" } }));
  await assert.rejects(taken.actions.signUp(input), ApiError);
  assert.equal(taken.bodies.length, 1);
});

test("a second timezone rejection after the retry surfaces (no loop)", async () => {
  const h = setup(() => tzIssue);
  await assert.rejects(h.actions.signUp(input), ApiError);
  assert.equal(h.bodies.length, 2);
});

test("rejectsOnlyTimezone", () => {
  assert.equal(rejectsOnlyTimezone(new ApiError({ kind: "http", status: 400, message: "x", issues: [{ path: "timezone", message: "m" }] })), true);
  assert.equal(rejectsOnlyTimezone(new ApiError({ kind: "http", status: 400, message: "x" })), false);
  assert.equal(rejectsOnlyTimezone(new Error("x")), false);
});

test("signOut clears the session even when the local wipe throws", async () => {
  const h = setup(() => ({ status: 204 }), async () => {
    throw new Error("disk full");
  });
  await assert.rejects(h.actions.signOut(), /disk full/);
  assert.equal(h.stored(), null);
});

test("email longer than 254 is rejected client-side", () => {
  const long = `${"a".repeat(250)}@b.co`;
  assert.equal(validateSignUp({ email: long, password: "x".repeat(10), username: "alpha", birthYear: "1990", acceptTerms: true }).email, "Use at most 254 characters.");
});

test("400s show the server's first validation issue", () => {
  const e = new ApiError({ kind: "http", status: 400, message: "Validation failed", issues: [{ path: "email", message: "Invalid email" }] });
  assert.equal(describeAuthError(e, "sign_in").message, "Rejected: Invalid email");
  assert.match(describeAuthError(new ApiError({ kind: "http", status: 400, message: "x" }), "sign_up").message, /rejected/);
});
