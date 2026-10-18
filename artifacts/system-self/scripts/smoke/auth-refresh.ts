// Smoke: register -> authed call -> forced refresh -> authed call still works.
// Usage: SMOKE_API_URL=http://localhost:3001 pnpm exec tsx scripts/smoke/auth-refresh.ts
import assert from "node:assert/strict";
import { createApiClient } from "../../lib/api/client";
import { AuthResponseSchema, type Session, type TokenStore } from "../../lib/api/session";

const baseUrl = process.env.SMOKE_API_URL;
if (!baseUrl) {
  console.error("SMOKE_API_URL is required, e.g. http://localhost:3001");
  process.exit(2);
}

let current: Session | null = null;
const tokens: TokenStore = {
  get: async () => current,
  set: async (s) => {
    current = s;
  },
};

let expired = 0;
let refreshCalls = 0;
const countingFetch: typeof fetch = (input, init) => {
  if (String(input).endsWith("/api/auth/refresh")) refreshCalls += 1;
  return fetch(input, init);
};
const client = createApiClient({ fetch: countingFetch, tokens, baseUrl, onSessionExpired: () => void expired++ });

async function main() {
  const suffix = Date.now().toString(36);
  const registered = await client.request("POST", "/api/auth/register", {
    auth: false,
    schema: AuthResponseSchema,
    body: {
      email: `smoke_${suffix}@example.com`,
      username: `smoke_${suffix}`.slice(0, 20),
      password: "smoke-password-123",
      birthYear: 1995,
      acceptTerms: true,
    },
  });
  await tokens.set(registered);
  console.log("registered", registered.user.username);

  const me1 = await client.request<{ user: { id: string } }>("GET", "/api/auth/me");
  assert.equal(me1.user.id, registered.user.id);
  console.log("authed call ok before refresh");

  // Force a refresh: the stored access token becomes garbage, so the server answers 401.
  await tokens.set({ ...registered, accessToken: "not-a-valid-token" });
  const results = await Promise.all([1, 2, 3].map(() => client.request<{ user: { id: string } }>("GET", "/api/auth/me")));
  for (const r of results) assert.equal(r.user.id, registered.user.id);
  assert.equal(refreshCalls, 1, "three concurrent 401s must trigger exactly one refresh");
  assert.notEqual(current?.refreshToken, registered.refreshToken, "refresh token rotated");
  assert.notEqual(current?.accessToken, "not-a-valid-token");
  assert.equal(expired, 0);
  console.log("forced refresh ok: 3 concurrent calls, 1 refresh, token rotated");

  // A revoked refresh token ends the session exactly once.
  await tokens.set({ ...current!, accessToken: "garbage", refreshToken: "revoked-or-unknown" });
  await assert.rejects(client.request("GET", "/api/auth/me"), (e: { status?: number }) => e.status === 401);
  assert.equal(current, null);
  assert.equal(expired, 1);
  console.log("invalid refresh token clears session, onSessionExpired x1");
  console.log("SMOKE PASS");
}

main().catch((e) => {
  console.error("SMOKE FAIL", e);
  process.exit(1);
});
