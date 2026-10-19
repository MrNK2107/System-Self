/**
 * Load-test dataset: N users (default 200), each registered and onboarded through the real API routes, then given
 * 30 days of history through the real POST /logs and POST /quests/:id/complete routes on an injected clock, so every
 * rollover, snapshot, streak, decay, notice, achievement and milestone is written by the production code paths.
 *
 *   LOAD_JWT_SECRET=<the load API's JWT_SECRET, 32+ chars> pnpm --filter @workspace/scripts load:seed [--users 200] [--days 30]
 *
 * Always (re)creates the dedicated database (LOAD_DATABASE_URL, default system_self_load; never dev or test), migrates
 * it, seeds it and writes the users' access tokens to scripts/load/.tokens.json (gitignored).
 */
import { writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { TOKENS_FILE, argValue, loadDatabaseUrl, prng, randomLog, type TokensFile } from "./common";

const USERS = Number(argValue("users") ?? 200);
const DAYS = Number(argValue("days") ?? 30);
const CONCURRENCY = Number(argValue("concurrency") ?? 8);
const TOKEN_TTL_SEC = Number(argValue("token-ttl") ?? 6 * 3600);
const TIMEZONES = ["UTC", "Asia/Kolkata", "Europe/Berlin", "America/New_York"];
/** Share of days a user is active (the rest are missed days: quests fail, streaks break, decay starts). */
const ACTIVE_RATE = 0.85;

const secret = process.env.LOAD_JWT_SECRET ?? "";
if (secret.length < 32) {
  console.error("LOAD_JWT_SECRET (32+ chars, the JWT_SECRET the load API runs with) is required");
  process.exit(1);
}
const { url, name, adminUrl } = loadDatabaseUrl();

// The API modules read their env when first imported: point them at the load DB, quietly, without limiters.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = url;
process.env.LOG_LEVEL = "silent";
process.env.RATE_LIMIT_DISABLED = "1";

const api = "../../artifacts/api-server/src";
const { createDb, users, profiles, scoreEvents, dailySnapshots, userDayState, domainScores, quests } = await import("@workspace/db");
const { runMigrations } = await import("../../lib/db/src/migrate");
const { addDays, endOfLocalDay, localDate } = await import("@workspace/engine");
const { and, eq, inArray, sql } = await import("drizzle-orm");
const { createApp } = await import(`${api}/app-factory`);
const { signAccessToken } = await import(`${api}/lib/auth/tokens`);
const { rolloverDueAt } = await import(`${api}/services/rollover`);

async function recreateDatabase(): Promise<void> {
  const admin = createDb(adminUrl, { max: 1 });
  try {
    await admin.pool.query(`drop database if exists ${name} with (force)`);
    await admin.pool.query(`create database ${name}`);
  } finally {
    await admin.pool.end();
  }
}

async function pool<T>(items: readonly T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]!, i);
      }
    }),
  );
}

const t0 = Date.now();
console.log(`recreating ${name} and migrating`);
await recreateDatabase();
await runMigrations(url);

const { db, pool: pg } = createDb(url, { max: CONCURRENCY + 2 });
let clock = new Date();
const app = createApp({ db, mailer: { async send() {} }, now: () => clock, rateLimitDisabled: true });
const server = app.listen(0);
await new Promise<void>((resolve) => server.once("listening", () => resolve()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

async function call(method: string, path: string, token: string | null, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

type Seeded = { id: string; username: string; tz: string; token: string; rand: () => number };
const seeded: Seeded[] = [];

// 1. Register and onboard (real routes, real clock: onboarding stamps new Date()).
console.log(`registering and onboarding ${USERS} users`);
await pool(
  Array.from({ length: USERS }, (_, i) => i),
  CONCURRENCY,
  async (i) => {
    const username = `load_${String(i).padStart(5, "0")}`;
    const tz = TIMEZONES[i % TIMEZONES.length]!;
    const reg = await call("POST", "/auth/register", null, {
      email: `${username}@load.test`,
      password: "load test password 1",
      username,
      birthYear: 1990,
      acceptTerms: true,
      timezone: tz,
    });
    if (reg.status !== 201) throw new Error(`register ${username}: ${reg.status} ${JSON.stringify(reg.json)}`);
    const token = reg.json.accessToken as string;
    const rand = prng(i + 1);
    const r = () => 2 + Math.floor(rand() * 7);
    const ob = await call("POST", "/onboarding", token, {
      ratings: { BODY: r(), MIND: r(), WEALTH: r(), SOCIAL: r(), DISCIPLINE: r() },
      primaryGoal: "Build a disciplined life",
      biggestWeakness: (["BODY", "MIND", "WEALTH", "SOCIAL", "DISCIPLINE"] as const)[i % 5],
      identitySetting: "anonymous",
      morningTime: "06:30",
      nightlyTime: "21:30",
      timezone: tz,
    });
    if (ob.status !== 201) throw new Error(`onboard ${username}: ${ob.status} ${JSON.stringify(ob.json)}`);
    const id = reg.json.user.id as string;
    // The register token lives 15 minutes; the seed runs longer. Same signer, this process's secret, a longer life.
    const long = await signAccessToken({ id, role: "user", tokenVersion: 0 }, { ttlSec: 4 * 3600 });
    seeded[i] = { id, username, tz, token: long.token, rand };
  },
);

// 2. Move the onboarding DAYS days back. Day d runs 13:00-18:00 UTC, inside one local day in every seeded timezone.
const today = new Date();
const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - DAYS, 13));
const at = (day: number, hour: number) => new Date(start.getTime() + day * 86_400_000 + hour * 3_600_000);
await pool(seeded, CONCURRENCY, async (u) => {
  const startDate = localDate(start, u.tz);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ createdAt: start, termsAcceptedAt: start }).where(eq(users.id, u.id));
    await tx.update(profiles).set({ onboardedAt: start, rankSince: start, baselineDate: startDate }).where(eq(profiles.userId, u.id));
    await tx.update(domainScores).set({ updatedAt: start }).where(eq(domainScores.userId, u.id));
    await tx
      .update(scoreEvents)
      .set({ createdAt: start, localDate: startDate })
      .where(and(eq(scoreEvents.userId, u.id), eq(scoreEvents.reason, "onboarding")));
    await tx.update(dailySnapshots).set({ localDate: startDate, createdAt: start }).where(eq(dailySnapshots.userId, u.id));
    await tx
      .update(userDayState)
      .set({ lastRolledDate: null, nextRolloverAt: rolloverDueAt(startDate, u.tz) })
      .where(eq(userDayState.userId, u.id));
  });
});

// 3. DAYS days of history, day by day for everyone (one shared clock): 3 daily quests, 0-4 logs, some completions.
const counts = { logs: 0, completes: 0, missedDays: 0, rejected: 0 };
for (let day = 0; day < DAYS; day++) {
  clock = at(day, 0);
  const board = new Map<string, string[]>();
  await pool(seeded, CONCURRENCY, async (u) => {
    const date = localDate(clock, u.tz);
    const rows = await db
      .insert(quests)
      .values(
        (["BODY", "MIND", "DISCIPLINE"] as const).map((domain) => ({
          userId: u.id,
          type: "daily",
          title: `${domain} daily`,
          description: "Load-test quest",
          domain,
          expiresAt: endOfLocalDay(date, u.tz),
          createdAt: clock,
        })),
      )
      .returning({ id: quests.id });
    board.set(u.id, rows.map((q) => q.id));
  });
  const active = new Map(seeded.map((u) => [u.id, u.rand() < ACTIVE_RATE]));
  counts.missedDays += [...active.values()].filter((a) => !a).length;
  for (const hour of [0, 2, 4]) {
    clock = at(day, hour);
    await pool(seeded, CONCURRENCY, async (u) => {
      if (!active.get(u.id) || (hour > 0 && u.rand() < 0.35)) return;
      const res = await call("POST", "/logs", u.token, { clientId: `seed-${u.id}-${day}-${hour}`, ...randomLog(u.rand) });
      if (res.status === 201) counts.logs++;
      else throw new Error(`log ${u.username} day ${day}: ${res.status} ${JSON.stringify(res.json)}`);
    });
  }
  clock = at(day, 5);
  await pool(seeded, CONCURRENCY, async (u) => {
    if (!active.get(u.id)) return;
    for (const id of board.get(u.id)!) {
      if (u.rand() < 0.4) continue;
      const res = await call("POST", `/quests/${id}/complete`, u.token, {});
      if (res.status === 200 || res.status === 201) counts.completes++;
      else counts.rejected++;
    }
  });
  process.stdout.write(`day ${day + 1}/${DAYS} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
}

// 4. Catch everyone up to the real now through GET /state (it rolls over on the real clock).
clock = new Date();
await pool(seeded, CONCURRENCY, async (u) => {
  const res = await call("GET", "/state", u.token);
  if (res.status !== 200) throw new Error(`state ${u.username}: ${res.status}`);
});

// 5. Today's board: three active dailies each, expiring at local midnight (GET /quests, the deadline job, rollover).
const now = new Date();
await pool(seeded, CONCURRENCY, async (u) => {
  await db.insert(quests).values(
    (["BODY", "MIND", "DISCIPLINE"] as const).map((domain) => ({
      userId: u.id,
      type: "daily",
      title: `${domain} daily`,
      description: "Load-test quest",
      domain,
      expiresAt: endOfLocalDay(localDate(now, u.tz), u.tz),
      createdAt: now,
    })),
  );
});

server.close();

// 6. Tokens for the load runner, signed like the server signs them, with the load API's secret.
const tokenVersions = await db
  .select({ id: users.id, ver: users.tokenVersion })
  .from(users)
  .where(inArray(users.id, seeded.map((u) => u.id)));
const verOf = new Map(tokenVersions.map((r) => [r.id, r.ver]));
const issued = new Date();
const out: TokensFile = {
  createdAt: issued.toISOString(),
  expiresAt: new Date(issued.getTime() + TOKEN_TTL_SEC * 1000).toISOString(),
  users: [],
};
for (const u of seeded) {
  const { token } = await signAccessToken({ id: u.id, role: "user", tokenVersion: verOf.get(u.id) ?? 0 }, { ttlSec: TOKEN_TTL_SEC, secret });
  out.users.push({ id: u.id, username: u.username, token });
}
writeFileSync(TOKENS_FILE, JSON.stringify(out, null, 2));

const size = await db.execute(sql`
  select (select count(*) from users) as users, (select count(*) from logs) as logs, (select count(*) from quests) as quests,
         (select count(*) from daily_snapshots) as snapshots, (select count(*) from score_events) as score_events,
         (select count(*) from notices) as notices, pg_size_pretty(pg_database_size(current_database())) as db_size`);
console.log("dataset", size.rows[0], counts);
console.log(`tokens: ${TOKENS_FILE} (valid until ${out.expiresAt}); ${Math.round((Date.now() - t0) / 1000)}s`);
await pg.end();
process.exit(0);
