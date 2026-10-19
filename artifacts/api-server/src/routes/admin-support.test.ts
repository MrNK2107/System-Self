// Support endpoints for admins: GET /api/admin/users/:id/export and POST /api/admin/users/:id/delete.
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import request from "supertest";
import pino from "pino";
import { eq, sql } from "drizzle-orm";
import { closeTestDb, resetDb } from "@workspace/db/testing";
import * as s from "@workspace/db/schema";
import { FORMER_OPERATOR_HANDLE } from "@workspace/contracts";
import { app, auth, db, setup, skip } from "./game-test-helpers";
import { NOW, seedEverything } from "./export-fixtures";
import { createApp } from "../app-factory";

after(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  if (db) await resetDb(db);
});

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

/** alice (the subject, every kind of data), bob and carol around her, and an admin. */
async function world(a: ReturnType<typeof app>) {
  const me = await setup(a);
  const b = await setup(a, { email: "bob@example.com", username: "bob_1" });
  const c = await setup(a, { email: "carol@example.com", username: "carol_1" });
  const admin = await setup(a, { email: "root@example.com", username: "root_1" });
  await db!.update(s.users).set({ role: "admin" }).where(eq(s.users.id, admin.id));
  await seedEverything(me.id, b.id, c.id);
  // Another player's notice naming alice by handle: deletion must scrub it.
  await db!.insert(s.notices).values({ userId: b.id, kind: "shame", payload: { handle: "alice_1" } });
  return { me, b, c, admin };
}

/** What a deletion leaves behind, with user ids replaced by names so two runs compare equal. */
async function aftermath(ids: Record<string, string>) {
  const name = (v: unknown) => {
    if (v === null || v === undefined) return null;
    for (const [k, id] of Object.entries(ids)) if (v === id) return k;
    return "other";
  };
  const tables = await db!.execute(sql`select tablename from pg_tables where schemaname = 'public' order by tablename`);
  const counts: Record<string, number> = {};
  for (const { tablename } of tables.rows as { tablename: string }[]) {
    const r = await db!.execute(sql.raw(`select count(*)::int as n from "${tablename}"`));
    counts[tablename] = (r.rows[0] as { n: number }).n;
  }
  const notices = (await db!.select().from(s.notices)).map((n) => ({ owner: name(n.userId), kind: n.kind, handle: (n.payload as { handle?: string }).handle ?? null }));
  const reports = (await db!.select().from(s.userReports)).map((r) => ({ reporter: name(r.reporterId), subject: name(r.subjectId), handle: r.subjectHandle }));
  const billing = (await db!.select().from(s.billingEvents)).map((e) => ({ id: e.id, user: name(e.userId), payload: e.payload }));
  const dispatches = (await db!.select().from(s.clanDispatches)).map((d) => ({ actor: name(d.actorId), subject: name(d.subjectId), text: d.text }));
  const sortJson = <T>(xs: T[]) => xs.map((x) => JSON.stringify(x)).sort();
  // The admin's own idempotency/refresh rows are the only allowed differences; neither is written in these runs.
  return { counts, notices: sortJson(notices), reports: sortJson(reports), billing: sortJson(billing), dispatches: sortJson(dispatches) };
}

test("admin support routes are admin-only", { skip }, async () => {
  const a = app({ now: () => NOW });
  const me = await setup(a);
  const other = await setup(a, { email: "bob@example.com", username: "bob_1" });
  assert.equal((await request(a).get(`/api/admin/users/${other.id}/export`).set(auth(me.token))).status, 403);
  assert.equal((await request(a).post(`/api/admin/users/${other.id}/delete`).set(auth(me.token)).send({ confirm: "bob_1" })).status, 403);
  assert.equal((await request(a).get(`/api/admin/users/${other.id}/export`)).status, 401);
  assert.equal((await db!.select().from(s.users).where(eq(s.users.id, other.id))).length, 1);
});

test("admin export is the user's own export, as the same attachment", { skip }, async () => {
  const a = app({ now: () => NOW });
  const { me, admin } = await world(a);
  const own = await request(a).get("/api/account/export").set(auth(me.token));
  assert.equal(own.status, 200);
  const res = await request(a).get(`/api/admin/users/${me.id}/export`).set(auth(admin.token));
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], own.headers["content-type"]);
  assert.equal(res.headers["content-disposition"], own.headers["content-disposition"]);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.text, own.text);
});

test("admin export and delete: non-UUID id is 400, unknown id is 404", { skip }, async () => {
  const a = app({ now: () => NOW });
  const admin = await setup(a, { email: "root@example.com", username: "root_1" });
  await db!.update(s.users).set({ role: "admin" }).where(eq(s.users.id, admin.id));
  assert.equal((await request(a).get("/api/admin/users/not-a-uuid/export").set(auth(admin.token))).status, 400);
  assert.equal((await request(a).post("/api/admin/users/not-a-uuid/delete").set(auth(admin.token)).send({ confirm: "x" })).status, 400);
  assert.equal((await request(a).get(`/api/admin/users/${UNKNOWN}/export`).set(auth(admin.token))).status, 404);
  assert.equal((await request(a).post(`/api/admin/users/${UNKNOWN}/delete`).set(auth(admin.token)).send({ confirm: "x" })).status, 404);
  assert.equal((await request(a).post(`/api/admin/users/${admin.id}/delete`).set(auth(admin.token)).send({})).status, 400);
});

test("admin delete: the confirm must be the username (409), and an admin cannot delete themself (409)", { skip }, async () => {
  const a = app({ now: () => NOW });
  const me = await setup(a);
  const admin = await setup(a, { email: "root@example.com", username: "root_1" });
  await db!.update(s.users).set({ role: "admin" }).where(eq(s.users.id, admin.id));

  const wrong = await request(a).post(`/api/admin/users/${me.id}/delete`).set(auth(admin.token)).send({ confirm: "bob_1" });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.code, "confirm_mismatch");
  assert.equal((await db!.select().from(s.users).where(eq(s.users.id, me.id))).length, 1);

  const self = await request(a).post(`/api/admin/users/${admin.id}/delete`).set(auth(admin.token)).send({ confirm: "root_1" });
  assert.equal(self.status, 409);
  assert.equal(self.body.code, "self_delete");
  assert.equal((await db!.select().from(s.users).where(eq(s.users.id, admin.id))).length, 1);
});

test("admin delete cascades and scrubs exactly like the user's own delete", { skip }, async () => {
  const a = app({ now: () => NOW });

  // Run 1: alice deletes herself.
  let w = await world(a);
  const own = await request(a).delete("/api/auth/account").set(auth(w.me.token)).send({ password: "correct horse battery" });
  assert.equal(own.status, 204);
  const byUser = await aftermath({ me: w.me.id, b: w.b.id, c: w.c.id, admin: w.admin.id });

  // Run 2: the same world, deleted by the admin.
  await resetDb(db!);
  w = await world(a);
  const res = await request(a).post(`/api/admin/users/${w.me.id}/delete`).set(auth(w.admin.token)).send({ confirm: "alice_1" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { deleted: true, id: w.me.id });
  const byAdmin = await aftermath({ me: w.me.id, b: w.b.id, c: w.c.id, admin: w.admin.id });

  assert.deepEqual(byAdmin, byUser);
  assert.equal(byAdmin.counts.users, 3);
  assert.ok(byAdmin.notices.some((n) => n.includes(FORMER_OPERATOR_HANDLE)), "the other player's notice was scrubbed");
  // The deleted user's tokens no longer work.
  assert.equal((await request(a).get("/api/auth/me").set(auth(w.me.token))).status, 401);
});

test("admin delete is idempotent: a retry with the same Idempotency-Key replays the result", { skip }, async () => {
  const a = app({ now: () => NOW });
  const me = await setup(a);
  const admin = await setup(a, { email: "root@example.com", username: "root_1" });
  await db!.update(s.users).set({ role: "admin" }).where(eq(s.users.id, admin.id));
  const send = () =>
    request(a).post(`/api/admin/users/${me.id}/delete`).set(auth(admin.token)).set("Idempotency-Key", "support-ticket-42").send({ confirm: "alice_1" });
  const first = await send();
  assert.equal(first.status, 200);
  const again = await send();
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body);
  // Without the key, the account is simply gone.
  const fresh = await request(a).post(`/api/admin/users/${me.id}/delete`).set(auth(admin.token)).send({ confirm: "alice_1" });
  assert.equal(fresh.status, 404);
});

test("every admin support call logs admin_action with actor, action and target, never the payload", { skip }, async () => {
  const lines: Record<string, unknown>[] = [];
  const sink = new Writable({
    write(chunk, _enc, done) {
      for (const l of String(chunk).split("\n")) if (l.trim()) lines.push(JSON.parse(l) as Record<string, unknown>);
      done();
    },
  });
  const a = createApp({ db, mailer: { async send() {} }, now: () => NOW, logger: pino({ level: "info" }, sink) });
  const me = await setup(a);
  const admin = await setup(a, { email: "root@example.com", username: "root_1" });
  await db!.update(s.users).set({ role: "admin" }).where(eq(s.users.id, admin.id));

  assert.equal((await request(a).get(`/api/admin/users/${me.id}/export`).set(auth(admin.token))).status, 200);
  assert.equal((await request(a).post(`/api/admin/users/${me.id}/delete`).set(auth(admin.token)).send({ confirm: "nope_1" })).status, 409);
  assert.equal((await request(a).post(`/api/admin/users/${me.id}/delete`).set(auth(admin.token)).send({ confirm: "alice_1" })).status, 200);

  const actions = lines.filter((l) => l.msg === "admin_action");
  assert.deepEqual(
    actions.map((l) => [l.action, l.actorId, l.targetId, l.status]),
    [
      ["user_export", admin.id, me.id, 200],
      ["user_delete", admin.id, me.id, 409],
      ["user_delete", admin.id, me.id, 200],
    ],
  );
  const text = JSON.stringify(actions);
  assert.ok(!text.includes("nope_1") && !text.includes("alice_1") && !text.includes("confirm"), "no request payload in the audit line");
});
