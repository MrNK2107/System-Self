import assert from "node:assert/strict";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestDb } from "@workspace/db/testing";
import { domainScores, notices } from "@workspace/db";
import { NoticeSchema } from "@workspace/contracts";
import { createApp } from "../app-factory";
import type { Mailer } from "../lib/mailer";
import type { AiDeps } from "../lib/ai";
import { toNotice } from "../services/scoring";

export const db = getTestDb();
export const skip = db ? false : "TEST_DATABASE_URL not set";
const mailer: Mailer = { async send() {} };

export const app = (extra: { ai?: AiDeps; now?: () => Date } = {}) => createApp({ db, mailer, ...extra });
export const TZ = "Asia/Kolkata";
export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Registers and onboards a user through the real routes; returns their token and id. */
export async function setup(a: ReturnType<typeof app>, who: { email?: string; username?: string } = {}) {
  const res = await request(a).post("/api/auth/register").send({
    email: who.email ?? "alice@example.com",
    password: "correct horse battery",
    username: who.username ?? "alice_1",
    birthYear: 1990,
    acceptTerms: true,
    timezone: TZ,
  });
  assert.equal(res.status, 201);
  const token = res.body.accessToken as string;
  const id = res.body.user.id as string;
  const ob = await request(a)
    .post("/api/onboarding")
    .set(auth(token))
    .send({
      ratings: { BODY: 5, MIND: 6, WEALTH: 4, SOCIAL: 7, DISCIPLINE: 3 },
      primaryGoal: "Build a disciplined life",
      biggestWeakness: "DISCIPLINE",
      identitySetting: "anonymous",
      morningTime: "06:30",
      nightlyTime: "21:30",
      timezone: TZ,
    });
  assert.equal(ob.status, 201);
  return { token, id };
}

export async function score(userId: string, domain: string) {
  const [r] = await db!
    .select()
    .from(domainScores)
    .where(and(eq(domainScores.userId, userId), eq(domainScores.domain, domain)));
  return r!;
}

/**
 * Parses `body` with a contract schema and checks nothing was stripped, so a response field the
 * contract does not declare fails the test as well as a missing or mistyped one.
 */
export function assertContract<T>(schema: { parse: (v: unknown) => T }, body: unknown): T {
  const parsed = schema.parse(body);
  assert.deepEqual(parsed, body);
  return parsed;
}

/** Every notice stored so far matches NoticeSchema (its payload shape for its kind). Use in afterEach. */
export async function assertStoredNoticesMatchContract(): Promise<void> {
  if (!db) return;
  for (const row of await db.select().from(notices)) assertContract(NoticeSchema, toNotice(row));
}
