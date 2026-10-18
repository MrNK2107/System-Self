// Smoke: drives the same calls AuthContext makes (lib/auth/actions) against a running API.
// register -> me -> gate -> logout -> wrong password -> login -> forgot -> reset code from the API log -> reset -> login.
// Usage: SMOKE_API_URL=http://localhost:3001 SMOKE_API_LOG=<path of the API's stdout log> pnpm exec tsx scripts/smoke/auth-flow.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ApiError, createApiClient } from "../../lib/api/client";
import type { Session, TokenStore } from "../../lib/api/session";
import { createAuthActions, describeAuthError, fetchOnboardingStatus } from "../../lib/auth/actions";

const baseUrl = process.env.SMOKE_API_URL;
const logPath = process.env.SMOKE_API_LOG;
if (!baseUrl || !logPath) {
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
const api = createApiClient({ fetch: (i, init) => fetch(i, init), tokens, baseUrl, onSessionExpired: () => events.push("expired") });
const auth = createAuthActions({
  api,
  tokens,
  handleSignIn: async (id) => void events.push(`handleSignIn:${id.slice(0, 8)}`),
  clearLocalData: async () => void events.push("clearLocalData"),
});

const step = (msg: string) => console.log(`ok  ${msg}`);

function resetCodeFromLog(email: string): string {
  const text = readFileSync(logPath!, "utf8");
  const re = /password reset code is (\d{6})/g;
  let last: string | null = null;
  for (const m of text.matchAll(re)) last = m[1]!;
  assert.ok(last, `no reset code for ${email} found in ${logPath}`);
  return last;
}

async function main() {
  const suffix = Date.now().toString(36);
  const email = `Flow_${suffix}@Example.com`; // mixed case on purpose: the app normalises it
  const username = `Flow_${suffix}`.slice(0, 20); // so does the codename
  const password = "first-password-1";
  const newPassword = "second-password-2";

  // register -> lands signed in, session stored, handleSignIn ran before the session was stored
  const user = await auth.signUp({ email, password, username, birthYear: 1995, acceptTerms: true, timezone: "Asia/Kolkata" });
  assert.equal(user.email, email.toLowerCase());
  assert.equal(user.username, username.toLowerCase());
  assert.ok(stored);
  assert.deepEqual(events, [`handleSignIn:${user.id.slice(0, 8)}`]);
  step(`register: ${user.email} / ${user.username}, session stored`);

  // me
  const me = await auth.fetchMe();
  assert.equal(me.id, user.id);
  assert.ok(/Kolkata|Calcutta/.test(me.timezone)); // the server stores its runtime's canonical spelling
  step(`me: timezone ${me.timezone}`);

  // gate: a fresh account has no profile yet
  assert.equal(await fetchOnboardingStatus(api), "not_onboarded");
  step("gate: GET /api/state 404 not_onboarded -> /onboarding");

  // duplicate registration maps to inline messages
  await assert.rejects(
    auth.signUp({ email, password, username: `x_${suffix}`.slice(0, 20), birthYear: 1995, acceptTerms: true, timezone: "UTC" }),
    (e) => {
      const info = describeAuthError(e, "sign_up");
      assert.deepEqual(info, { message: "That email is already registered.", field: "email" });
      return true;
    },
  );
  await assert.rejects(
    auth.signUp({ email: `other_${suffix}@example.com`, password, username, birthYear: 1995, acceptTerms: true, timezone: "UTC" }),
    (e) => describeAuthError(e, "sign_up").message === "That codename is taken.",
  );
  step("register again: email_taken and username_taken map to inline copy");

  // age gate comes back as 400 from the server (client validation normally stops it earlier)
  await assert.rejects(
    auth.signUp({ email: `kid_${suffix}@example.com`, password, username: `kid_${suffix}`.slice(0, 20), birthYear: new Date().getFullYear() - 10, acceptTerms: true, timezone: "UTC" }),
    (e) => e instanceof ApiError && e.status === 400,
  );
  step("register under 16: server 400");

  // logout wipes local data (while the session still exists) then the session
  await auth.signOut();
  assert.equal(stored, null);
  assert.equal(events.at(-1), "clearLocalData");
  step("logout: refresh token revoked, local data cleared, session cleared");

  // wrong password
  await assert.rejects(auth.signIn(email, "definitely-wrong"), (e) => {
    assert.equal(describeAuthError(e, "sign_in").message, "Invalid email or password.");
    return true;
  });
  assert.equal(stored, null);
  step('login with wrong password: "Invalid email or password."');

  // login
  const again = await auth.signIn(email, password);
  assert.equal(again.id, user.id);
  assert.ok(stored);
  step("login: ok, same account");
  await auth.signOut();

  // forgot -> code from the API log -> reset
  await auth.requestPasswordReset(email);
  await new Promise((r) => setTimeout(r, 500)); // mail is sent in the background
  const code = resetCodeFromLog(email);
  console.log(`    reset code read from API log: ${code}`);
  await assert.rejects(auth.resetPassword(email, code === "000000" ? "111111" : "000000", newPassword), (e) => {
    assert.equal(describeAuthError(e, "reset").message, "That code is incorrect.");
    return true;
  });
  step('reset with a wrong code: "That code is incorrect."');
  await auth.resetPassword(email, code, newPassword);
  step("reset with the logged code: 204");

  // old password dead, new password works
  await assert.rejects(auth.signIn(email, password), (e) => e instanceof ApiError && e.status === 401);
  const final = await auth.signIn(email, newPassword);
  assert.equal(final.id, user.id);
  step("login with the old password rejected; login with the new password ok");

  // the reset code is single use
  await assert.rejects(auth.resetPassword(email, code, "third-password-3"), (e) => e instanceof ApiError && e.status === 400);
  step("reset code is single use");

  console.log("SMOKE PASS");
}

main().catch((e) => {
  console.error("SMOKE FAIL", e);
  process.exit(1);
});
