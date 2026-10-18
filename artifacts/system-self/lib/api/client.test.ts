import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { ApiError, createApiClient } from "./client";
import type { Session, TokenStore } from "./session";

const user = {
  id: "u1",
  email: "a@b.co",
  username: "abc",
  role: "user" as const,
  emailVerified: true,
  timezone: "UTC",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function session(n: number): Session {
  return { accessToken: `access-${n}`, accessTokenExpiresAt: "2099-01-01T00:00:00.000Z", refreshToken: `refresh-${n}`, user };
}

function memoryTokens(initial: Session | null): TokenStore & { value: Session | null } {
  const store = {
    value: initial,
    async get() {
      return store.value;
    },
    async set(s: Session | null) {
      store.value = s;
    },
  };
  return store;
}

const json = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; auth: string | null; idem: string | null; body: string | null };

function harness(handler: (call: Call) => Response | Promise<Response>, initial: Session | null = session(1)) {
  const calls: Call[] = [];
  const tokens = memoryTokens(initial);
  let expired = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      auth: headers.get("authorization"),
      idem: headers.get("idempotency-key"),
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  const client = createApiClient({ fetch: fetchImpl, tokens, baseUrl: "http://x.test", onSessionExpired: () => void expired++ });
  return { client, calls, tokens, expired: () => expired };
}

const isRefresh = (c: Call) => c.url.endsWith("/api/auth/refresh");

test("attaches bearer token", async () => {
  const h = harness(() => json(200, { ok: true }));
  const res = await h.client.request<{ ok: boolean }>("GET", "/api/state");
  assert.deepEqual(res, { ok: true });
  assert.equal(h.calls[0]!.url, "http://x.test/api/state");
  assert.equal(h.calls[0]!.auth, "Bearer access-1");
});

test("401 -> refresh -> retry succeeds", async () => {
  const h = harness((c) => {
    if (isRefresh(c)) {
      assert.equal(c.auth, null);
      assert.deepEqual(JSON.parse(c.body!), { refreshToken: "refresh-1" });
      return json(200, { ...session(2) });
    }
    return c.auth === "Bearer access-2" ? json(200, { n: 1 }) : json(401, { error: "Unauthorized" });
  });
  const res = await h.client.request<{ n: number }>("GET", "/api/state");
  assert.deepEqual(res, { n: 1 });
  assert.equal(h.tokens.value?.accessToken, "access-2");
  assert.equal(h.tokens.value?.refreshToken, "refresh-2");
  assert.equal(h.expired(), 0);
});

test("5 concurrent 401s trigger one refresh", async () => {
  const h = harness(async (c) => {
    if (isRefresh(c)) {
      await new Promise((r) => setTimeout(r, 20));
      return json(200, { ...session(2) });
    }
    return c.auth === "Bearer access-2" ? json(200, { ok: true }) : json(401, { error: "Unauthorized" });
  });
  const results = await Promise.all([1, 2, 3, 4, 5].map((i) => h.client.request("GET", `/api/x${i}`)));
  assert.equal(results.length, 5);
  assert.equal(h.calls.filter(isRefresh).length, 1);
  assert.equal(h.calls.filter((c) => c.auth === "Bearer access-2").length, 5);
});

test("refresh 401 -> session cleared and onSessionExpired called once", async () => {
  const h = harness((c) =>
    isRefresh(c) ? json(401, { error: "Invalid refresh token", code: "invalid_refresh" }) : json(401, { error: "Unauthorized" }),
  );
  const results = await Promise.allSettled([h.client.request("GET", "/api/a"), h.client.request("GET", "/api/b")]);
  for (const r of results) {
    assert.equal(r.status, "rejected");
    const err = (r as PromiseRejectedResult).reason as ApiError;
    assert.equal(err.kind, "http");
    assert.equal(err.status, 401);
  }
  assert.equal(h.tokens.value, null);
  assert.equal(h.expired(), 1);
  assert.equal(h.calls.filter(isRefresh).length, 1);
});

test("network error does not clear the session", async () => {
  const h = harness(() => {
    throw new TypeError("Network request failed");
  });
  await assert.rejects(h.client.request("GET", "/api/state"), (e: ApiError) => e.kind === "network");
  assert.equal(h.tokens.value?.refreshToken, "refresh-1");
  assert.equal(h.expired(), 0);
});

test("network error during refresh does not clear the session", async () => {
  const h = harness((c) => {
    if (isRefresh(c)) throw new TypeError("Network request failed");
    return json(401, { error: "Unauthorized" });
  });
  await assert.rejects(h.client.request("GET", "/api/state"), (e: ApiError) => e.kind === "network");
  assert.equal(h.tokens.value?.refreshToken, "refresh-1");
  assert.equal(h.expired(), 0);
});

test("non-2xx becomes ApiError http with code and message", async () => {
  const h = harness(() => json(409, { error: "Not onboarded", code: "not_onboarded" }));
  await assert.rejects(
    h.client.request("POST", "/api/logs", { body: { a: 1 } }),
    (e: ApiError) => e.kind === "http" && e.status === 409 && e.code === "not_onboarded" && e.message === "Not onboarded",
  );
  assert.equal(h.calls[0]!.body, JSON.stringify({ a: 1 }));
});

test("401 with an endpoint error code is not treated as an expired token", async () => {
  const h = harness(() => json(401, { error: "Invalid password", code: "invalid_password" }));
  await assert.rejects(h.client.request("POST", "/api/auth/password/change"), (e: ApiError) => e.code === "invalid_password");
  assert.equal(h.calls.length, 1);
  assert.equal(h.tokens.value?.accessToken, "access-1");
});

test("auth:false sends no token and never refreshes", async () => {
  const h = harness(() => json(401, { error: "Invalid email or password" }));
  await assert.rejects(h.client.request("POST", "/api/auth/login", { auth: false, body: {} }), (e: ApiError) => e.status === 401);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0]!.auth, null);
  assert.equal(h.expired(), 0);
});

test("204 resolves to null; idempotency key is sent as a header", async () => {
  const h = harness(() => new Response(null, { status: 204 }));
  const res = await h.client.request("DELETE", "/api/x", { idempotencyKey: "k1" });
  assert.equal(res, null);
  assert.equal(h.calls[0]!.idem, "k1");
});

test("schema parses the response and rejects a mismatch", async () => {
  const h = harness(() => json(200, { n: "nope" }));
  await assert.rejects(h.client.request("GET", "/api/x", { schema: z.object({ n: z.number() }) }), (e: ApiError) => e.kind === "parse");
});

test("no session: 401 surfaces without a refresh attempt", async () => {
  const h = harness(() => json(401, { error: "Unauthorized" }), null);
  await assert.rejects(h.client.request("GET", "/api/state"), (e: ApiError) => e.status === 401);
  assert.equal(h.calls.length, 1);
  assert.equal(h.expired(), 0);
});
