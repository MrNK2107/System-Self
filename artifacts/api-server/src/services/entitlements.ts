/**
 * Entitlement gate. P5 stub: only an admin can grant PRO (POST /api/admin/users/:id/entitlement). P7 replaces the
 * source with RevenueCat webhooks writing the same `entitlements` row; `isPro` and `requirePro` stay as they are.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { entitlements, type Db } from "@workspace/db";
import { PRO_REQUIRED_CODE } from "@workspace/contracts";

/** True when the user holds a `pro` row that has not expired at `now` (the expiry instant itself is expired). */
export async function isPro(db: Pick<Db, "select">, userId: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ tier: entitlements.tier, expiresAt: entitlements.expiresAt })
    .from(entitlements)
    .where(eq(entitlements.userId, userId))
    .limit(1);
  if (!row || row.tier !== "pro") return false;
  return row.expiresAt === null || row.expiresAt.getTime() > now.getTime();
}

/** Sets (or replaces) a user's tier from an admin grant. */
export async function grantEntitlement(
  db: Pick<Db, "insert">,
  userId: string,
  tier: "free" | "pro",
  expiresAt: Date | null,
  now: Date,
) {
  const [row] = await db
    .insert(entitlements)
    .values({ userId, tier, source: "admin", expiresAt, updatedAt: now })
    .onConflictDoUpdate({ target: entitlements.userId, set: { tier, source: "admin", expiresAt, updatedAt: now } })
    .returning();
  return row!;
}

/** Route guard for PRO features: 402 `{ code: "pro_required" }` for everyone else. Mount after requireAuth. */
export function requirePro(db: Pick<Db, "select">, clock: () => Date = () => new Date()): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (!(await isPro(db, req.user.id, clock()))) {
        res.status(402).json({ error: "PRO required", code: PRO_REQUIRED_CODE });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
