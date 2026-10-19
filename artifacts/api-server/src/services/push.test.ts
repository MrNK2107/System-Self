import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import { pushTokens } from "@workspace/db";
import { app, db, setup, skip } from "../routes/game-test-helpers";
import { createExpoTransport, EXPO_PUSH_URL, sendPushMessages, type PushMessage } from "./push";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const msg = (to: string): PushMessage => ({ to, title: "SYSTEM // SELF", body: "x", badge: 0, channelId: "system-self" });

function fakeFetch() {
  const calls: { url: string; init: RequestInit; batch: PushMessage[] }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const batch = JSON.parse(String(init!.body)) as PushMessage[];
    calls.push({ url: String(url), init: init!, batch });
    const data = batch.map(() => ({ status: "ok", id: "r" }));
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

test("expo transport posts to the Expo endpoint in batches of 100 and returns tickets in order", async () => {
  const f = fakeFetch();
  const transport = createExpoTransport({ fetch: f.fn });
  const messages = Array.from({ length: 250 }, (_, i) => msg(`ExponentPushToken[${i}]`));
  const tickets = await transport(messages);
  assert.equal(EXPO_PUSH_URL, "https://exp.host/--/api/v2/push/send");
  assert.deepEqual(
    f.calls.map((c) => c.batch.length),
    [100, 100, 50],
  );
  assert.ok(f.calls.every((c) => c.url === EXPO_PUSH_URL));
  assert.equal(tickets.length, 250);
  assert.equal(f.calls[0]!.batch[0]!.to, "ExponentPushToken[0]");
  assert.equal(f.calls[2]!.batch[49]!.to, "ExponentPushToken[249]");
});

test("expo transport sends a Bearer token only when an access token is configured", async () => {
  const without = fakeFetch();
  await createExpoTransport({ fetch: without.fn })([msg("ExponentPushToken[a]")]);
  assert.equal((without.calls[0]!.init.headers as Record<string, string>).Authorization, undefined);
  const withTok = fakeFetch();
  await createExpoTransport({ fetch: withTok.fn, accessToken: "secret" })([msg("ExponentPushToken[a]")]);
  assert.equal((withTok.calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer secret");
});

test("expo transport: a failed batch yields error tickets for its messages and later batches still send", async () => {
  let n = 0;
  const fn = (async (_u: unknown, init?: RequestInit) => {
    const batch = JSON.parse(String(init!.body)) as PushMessage[];
    if (n++ === 0) return new Response("boom", { status: 500 });
    return new Response(JSON.stringify({ data: batch.map(() => ({ status: "ok" })) }), { status: 200 });
  }) as typeof fetch;
  const tickets = await createExpoTransport({ fetch: fn })(Array.from({ length: 101 }, (_, i) => msg(`ExponentPushToken[${i}]`)));
  assert.equal(tickets.length, 101);
  assert.equal(tickets[0]!.status, "error");
  assert.equal(tickets[100]!.status, "ok");
});

test("DeviceNotRegistered tickets delete exactly that token", { skip }, async () => {
  const { id } = await setup(app());
  await db!.insert(pushTokens).values([
    { userId: id, token: "ExponentPushToken[dead]", platform: "ios" },
    { userId: id, token: "ExponentPushToken[live]", platform: "android" },
  ]);
  const transport = async (ms: PushMessage[]) =>
    ms.map((m) =>
      m.to.includes("dead")
        ? { status: "error" as const, message: "gone", details: { error: "DeviceNotRegistered" } }
        : { status: "ok" as const, id: "r1" },
    );
  const out = await sendPushMessages(db!, transport, [msg("ExponentPushToken[dead]"), msg("ExponentPushToken[live]")]);
  assert.deepEqual(out, { sent: 1, removed: 1, errors: 1, errorCodes: { DeviceNotRegistered: 1 } });
  const left = await db!.select().from(pushTokens).where(eq(pushTokens.userId, id));
  assert.deepEqual(
    left.map((t) => t.token),
    ["ExponentPushToken[live]"],
  );
});

test("other ticket errors keep the token", { skip }, async () => {
  const { id } = await setup(app());
  await db!.insert(pushTokens).values({ userId: id, token: "ExponentPushToken[a]", platform: "ios" });
  const transport = async (ms: PushMessage[]) => ms.map(() => ({ status: "error" as const, details: { error: "MessageRateExceeded" } }));
  assert.deepEqual(await sendPushMessages(db!, transport, [msg("ExponentPushToken[a]")]), {
    sent: 0,
    removed: 0,
    errors: 1,
    errorCodes: { MessageRateExceeded: 1 },
  });
  assert.equal((await db!.select().from(pushTokens)).length, 1);
});

test("expo transport gives every request a timeout signal and turns a timeout into error tickets", async () => {
  const signals: (AbortSignal | null | undefined)[] = [];
  const fn = (async (_u: unknown, init?: RequestInit) => {
    signals.push(init!.signal);
    return new Promise<Response>((_, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)));
  }) as typeof fetch;
  const started = Date.now();
  const tickets = await createExpoTransport({ fetch: fn, timeoutMs: 50 })([msg("ExponentPushToken[a]")]);
  assert.ok(Date.now() - started < 5000);
  assert.ok(signals[0] instanceof AbortSignal);
  assert.deepEqual(tickets.map((t) => t.status), ["error"]);
});
