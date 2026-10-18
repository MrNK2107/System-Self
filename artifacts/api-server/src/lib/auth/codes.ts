import { randomInt, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { emailCodes, type Db } from "@workspace/db";
import { hashToken } from "./tokens";

export type CodePurpose = "verify" | "reset";

const CODE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
/** Per-account, per-purpose cap on codes created in the trailing hour (stops mail bombing one inbox). */
export const MAX_CODES_PER_HOUR = 5;

// Salted with userId so identical codes for different users hash differently.
const hashCode = (userId: string, code: string) => hashToken(`${userId}:${code}`);

/**
 * Accepts a Db or an open transaction (nested transactions become savepoints).
 * Returns null, creating nothing, when the hourly cap for this user and purpose is reached.
 */
export async function createEmailCode(
  db: Pick<Db, "transaction">,
  userId: string,
  purpose: CodePurpose,
): Promise<string | null> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  return db.transaction(async (tx) => {
    // Serialize code creation per user+purpose so concurrent requests cannot overshoot the cap.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`email_code:${userId}:${purpose}`}))`);
    const [recent] = await tx
      .select({ n: count() })
      .from(emailCodes)
      .where(
        and(
          eq(emailCodes.userId, userId),
          eq(emailCodes.purpose, purpose),
          gt(emailCodes.createdAt, new Date(Date.now() - 60 * 60_000)),
        ),
      );
    if ((recent?.n ?? 0) >= MAX_CODES_PER_HOUR) return null;
    await tx
      .update(emailCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(emailCodes.userId, userId), eq(emailCodes.purpose, purpose), isNull(emailCodes.consumedAt)));
    await tx.insert(emailCodes).values({
      userId,
      purpose,
      codeHash: hashCode(userId, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    return code;
  });
}

export async function consumeEmailCode(
  db: Db,
  userId: string,
  purpose: CodePurpose,
  code: string,
): Promise<"ok" | "invalid" | "expired" | "locked"> {
  const [row] = await db
    .select()
    .from(emailCodes)
    .where(and(eq(emailCodes.userId, userId), eq(emailCodes.purpose, purpose), isNull(emailCodes.consumedAt)))
    .orderBy(desc(emailCodes.createdAt))
    .limit(1);
  if (!row) return "invalid";
  if (row.expiresAt.getTime() <= Date.now()) return "expired";

  // Atomically claim an attempt before comparing, so concurrent guesses cannot exceed the limit.
  const claimedAttempt = await db
    .update(emailCodes)
    .set({ attempts: sql`${emailCodes.attempts} + 1` })
    .where(and(eq(emailCodes.id, row.id), isNull(emailCodes.consumedAt), lt(emailCodes.attempts, MAX_ATTEMPTS)))
    .returning({ id: emailCodes.id });
  if (claimedAttempt.length === 0) return "locked";

  const a = Buffer.from(hashCode(userId, code));
  const b = Buffer.from(row.codeHash);
  if (a.length === b.length && timingSafeEqual(a, b)) {
    const claimed = await db
      .update(emailCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(emailCodes.id, row.id), isNull(emailCodes.consumedAt)))
      .returning({ id: emailCodes.id });
    return claimed.length ? "ok" : "invalid";
  }
  return "invalid";
}
