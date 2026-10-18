import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createApiClient, shouldRetryQuery } from "./client";
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
const session = (n: number): Session => ({
  accessToken: `access-${n}`,
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: `refresh-${n}`,
  user,
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function memoryTokens(initial: Session | null): TokenStore & { value: Session | null } {
  const store = {
    value: initial,
    get: async () => store.value,
    set: async (s: Session | null) => void (store.value = s),
  };
  return store;
}

type Handler = (url: string, auth: string | null) => Response | Promise<Response>;

function make(handler: Handler, tokens: TokenStore, onSessionExpired: () => void = () => {}) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization");
    calls.push({ url: String(input), auth });
    return handler(String(input), auth);
  }) as unknown as typeof fetch;
  return { client: createApiClient({ fetch: fetchImpl, tokens, baseUrl: "http://x.test", onSessionExpired }), calls };
}

const isRefresh = (u: string) => u.endsWith("/api/auth/refresh");

test("refresh 5xx and 429 keep the session and surface the error", async () => {
  for (const status of [500, 503, 429]) {
    const tokens = memoryTokens(session(1));
    let expired = 0;
    const h = make((u) => (isRefresh(u) ? json(status, { error: "later" }) : json(401, { error: "Unauthorized" })), tokens, () => void expired++);
    await assert.rejects(h.client.request("GET", "/api/state"), (e: ApiError) => e.kind === "http" && e.status === status);
    assert.equal(tokens.value?.refreshToken, "refresh-1", `status ${status}`);
    assert.equal(expired, 0);
  }
});

test("late 401 after another request already rotated the token retries without a second refresh", async () => {
  let open: () => void = () => {};
  const gate = new Promise<void>((r) => (open = r));
  const tokens = memoryTokens(session(1));
  const h = make(async (u, auth) => {
    if (isRefresh(u)) return json(200, session(2));
    if (u.endsWith("/api/slow") && auth === "Bearer access-1") {
      await gate; // this 401 only arrives after the other request has refreshed
      return json(401, { error: "Unauthorized" });
    }
    return auth === "Bearer access-2" ? json(200, { ok: u }) : json(401, { error: "Unauthorized" });
  }, tokens);
  const slow = h.client.request("GET", "/api/slow");
  await h.client.request("GET", "/api/fast");
  assert.equal(tokens.value?.accessToken, "access-2");
  open();
  assert.deepEqual(await slow, { ok: "http://x.test/api/slow" });
  assert.equal(h.calls.filter((c) => isRefresh(c.url)).length, 1);
});

test("token store failures become ApiError storage", async () => {
  const broken: TokenStore = {
    get: async () => {
      throw new Error("keychain locked");
    },
    set: async () => {},
  };
  const h = make(() => json(200, {}), broken);
  await assert.rejects(h.client.request("GET", "/api/x"), (e: ApiError) => e.kind === "storage");
});

test("request timeout covers a body that never finishes", async () => {
  const realSetTimeout = globalThis.setTimeout;
  // Shrink the 30 s timeout so the test is quick; only timers of exactly that length are rewritten.
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) =>
    realSetTimeout(fn, ms === 30_000 ? 20 : ms, ...rest)) as typeof setTimeout;
  try {
    const hang = (async (_u: string, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const client = createApiClient({ fetch: hang, tokens: memoryTokens(session(1)), baseUrl: "http://x.test", onSessionExpired() {} });
    await assert.rejects(client.request("GET", "/api/x"), (e: ApiError) => e.kind === "network");
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test("shouldRetryQuery retries only network / 5xx, at most twice", () => {
  const net = new ApiError({ kind: "network", message: "x" });
  const s503 = new ApiError({ kind: "http", status: 503, message: "x" });
  const s404 = new ApiError({ kind: "http", status: 404, message: "x" });
  assert.equal(shouldRetryQuery(0, net), true);
  assert.equal(shouldRetryQuery(1, s503), true);
  assert.equal(shouldRetryQuery(2, net), false);
  assert.equal(shouldRetryQuery(0, s404), false);
  assert.equal(shouldRetryQuery(0, new Error("boom")), false);
});
