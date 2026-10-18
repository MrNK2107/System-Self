import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { refreshTokens, type Db, type RefreshToken } from "@workspace/db";
import { env } from "../env";
import { hashToken } from "./tokens";

type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * A client whose refresh response was lost may retry with the token it already sent.
 * Within this window (measured from the original rotation) the retry supersedes the
 * unseen successor instead of being treated as token theft.
 */
export const REFRESH_GRACE_MS = 30_000;

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
    const selectRow = async () =>
      (await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash)).limit(1))[0];

    const issueInFamily = async (row: RefreshToken): Promise<RotateResult> => {
      const next = await insertToken(tx, row.userId, { familyId: row.familyId, userAgent });
      await tx.update(refreshTokens).set({ replacedById: next.id }).where(eq(refreshTokens.id, row.id));
      return { ok: true, userId: row.userId, token: next.token, expiresAt: next.expiresAt };
    };

    // Called with a row that is already revoked: grace retry, or reuse (revoke the whole family).
    const handleRevoked = async (row: RefreshToken): Promise<RotateResult> => {
      const withinGrace =
        row.replacedById !== null && row.revokedAt !== null && Date.now() - row.revokedAt.getTime() < REFRESH_GRACE_MS;
      if (withinGrace && row.expiresAt.getTime() > Date.now()) {
        // Only a successor that is still live may be superseded; a revoked one means logout or reuse.
        const superseded = await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date(), revokedReason: "superseded" })
          .where(and(eq(refreshTokens.id, row.replacedById!), isNull(refreshTokens.revokedAt)))
          .returning({ id: refreshTokens.id });
        if (superseded.length === 1) return issueInFamily(row);
      }
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date(), revokedReason: "reused" })
        .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
      return { ok: false, reason: "reused" };
    };

    const row = await selectRow();
    if (!row) return { ok: false, reason: "invalid" };
    if (row.revokedAt) return handleRevoked(row);
    if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

    // Conditional update guards against two concurrent rotations of the same token.
    const claimed = await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: "rotated" })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (claimed.length === 0) {
      // A concurrent rotation won; re-read its committed state and treat this call as a retry.
      const current = await selectRow();
      return current?.revokedAt ? handleRevoked(current) : { ok: false, reason: "reused" };
    }
    return issueInFamily(row);
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
    .set({ revokedAt: new Date(), revokedReason: "logout" })
    .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllForUser(db: Pick<Db, "update">, userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), revokedReason: "revoked_all" })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
