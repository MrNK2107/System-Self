import assert from "node:assert/strict";
import { test } from "node:test";
import { newRequestId } from "./request-id";
import { createApiClient } from "./client";

const VALID = /^[A-Za-z0-9-]{1,64}$/;

test("newRequestId is server-acceptable and unique", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newRequestId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, VALID);
});

test("newRequestId falls back to a v4 uuid without crypto.randomUUID", () => {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    assert.match(newRequestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
  }
});

test("every request carries a fresh x-request-id header", async () => {
  const seen: string[] = [];
  const client = createApiClient({
    fetch: async (_url, init) => {
      seen.push((init?.headers as Record<string, string>)["x-request-id"] ?? "");
      return new Response("{}", { status: 200 });
    },
    tokens: { async get() { return null; }, async set() {} },
    baseUrl: "http://x",
    onSessionExpired: () => {},
  });
  await client.request("GET", "/api/a", { auth: false });
  await client.request("GET", "/api/b", { auth: false });
  assert.equal(seen.length, 2);
  assert.match(seen[0]!, VALID);
  assert.notEqual(seen[0], seen[1]);
});
