import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { refreshTokens, type Db } from "@workspace/db";
import { env } from "../env";
import { hashToken } from "./tokens";

type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const newToken = () => randomBytes(32).toString("base64url");
const newExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

async function insertToken(
  ex: Executor,
  userId: string,
  opts: { id?: string; familyId?: string; userAgent?: string } = {},
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const token = newToken();
  const id = opts.id ?? randomUUID();
  const expiresAt = newExpiry();
  await ex.insert(refreshTokens).values({
    id,
    userId,
    familyId: opts.familyId ?? randomUUID(),
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: opts.userAgent ?? null,
  });
  return { token, id, expiresAt };
}

export function issueRefreshToken(
  db: Db,
  userId: string,
  opts?: { familyId?: string; userAgent?: string },
): Promise<{ token: string; id: string; expiresAt: Date }> {
  return insertToken(db, userId, opts);
}

export type RotateResult =
  | { ok: true; userId: string; token: string; expiresAt: Date }
  | { ok: false; reason: "invalid" | "expired" | "reused" };

export async function rotateRefreshToken(db: Db, token: string, userAgent?: string): Promise<RotateResult> {
  const hash = hashToken(token);
  return db.transaction(async (tx): Promise<RotateResult> => {
    const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash)).limit(1);
    if (!row) return { ok: false, reason: "invalid" };

    const revokeFamily = () =>
      tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));

    if (row.revokedAt) {
      await revokeFamily();
      return { ok: false, reason: "reused" };
    }
    if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

    const newId = randomUUID();
    // Conditional update guards against two concurrent rotations of the same token.
    const claimed = await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedById: newId })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (claimed.length === 0) {
      await revokeFamily();
      return { ok: false, reason: "reused" };
    }
    const next = await insertToken(tx, row.userId, { id: newId, familyId: row.familyId, userAgent });
    return { ok: true, userId: row.userId, token: next.token, expiresAt: next.expiresAt };
  });
}

export async function revokeRefreshFamilyByToken(db: Db, token: string): Promise<void> {
  const [row] = await db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return;
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllForUser(db: Db, userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
