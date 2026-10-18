import { randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { emailCodes, type Db } from "@workspace/db";
import { hashToken } from "./tokens";

export type CodePurpose = "verify" | "reset";

const CODE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

// Salted with userId so identical codes for different users hash differently.
const hashCode = (userId: string, code: string) => hashToken(`${userId}:${code}`);

export async function createEmailCode(db: Db, userId: string, purpose: CodePurpose): Promise<string> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await db.transaction(async (tx) => {
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
  });
  return code;
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
  if (row.attempts >= MAX_ATTEMPTS) return "locked";
  if (row.expiresAt.getTime() <= Date.now()) return "expired";

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
  await db
    .update(emailCodes)
    .set({ attempts: row.attempts + 1 })
    .where(eq(emailCodes.id, row.id));
  return "invalid";
}
