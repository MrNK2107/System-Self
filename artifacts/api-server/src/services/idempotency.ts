import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { idempotencyKeys, type Db } from "@workspace/db";

export interface HandlerResult {
  status: number;
  body: unknown;
}

function readKey(req: Request): string | null {
  const header = req.get("Idempotency-Key");
  if (header && header.trim()) return header.trim().slice(0, 200);
  const clientId = (req.body as { clientId?: unknown } | undefined)?.clientId;
  if (typeof clientId === "string" && clientId.trim()) return clientId.trim().slice(0, 200);
  return null;
}

/**
 * Runs `handler` and sends its result. With an `Idempotency-Key` header (or `clientId` body field) the
 * successful (2xx) result is stored per user and replayed with 200 on a repeat. Error results are
 * not stored, so a failed attempt can be retried. Requires req.user (mount behind requireAuth).
 */
export async function withIdempotency(
  db: Db,
  req: Request,
  res: Response,
  routeKey: string,
  handler: () => Promise<HandlerResult>,
): Promise<void> {
  const userId = req.user!.id;
  const key = readKey(req);
  if (key) {
    const [prior] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
      .limit(1);
    if (prior) {
      if (prior.route !== routeKey) {
        res
          .status(409)
          .json({ error: "Idempotency key already used for another request", code: "idempotency_key_reuse" });
        return;
      }
      res.status(200).json(prior.responseBody);
      return;
    }
  }
  const result = await handler();
  if (key && result.status >= 200 && result.status < 300) {
    await db
      .insert(idempotencyKeys)
      .values({ userId, key, route: routeKey, responseStatus: result.status, responseBody: result.body ?? null })
      .onConflictDoNothing();
  }
  res.status(result.status).json(result.body);
}
