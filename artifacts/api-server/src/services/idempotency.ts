import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { idempotencyKeys, type Db } from "@workspace/db";
import { withUserLock, type Tx } from "./user-lock";

export interface HandlerResult {
  status: number;
  body: unknown;
}

export interface KeyOptions {
  /** Use the body's `clientId` ahead of the Idempotency-Key header (routes whose clientId names the record). */
  preferClientId?: boolean;
}

/** The request's idempotency key: the Idempotency-Key header, else the body's `clientId` (or the reverse). */
export function readKey(req: Request, opts: KeyOptions = {}): string | null {
  const header = req.get("Idempotency-Key")?.trim() || null;
  const raw = (req.body as { clientId?: unknown } | undefined)?.clientId;
  const clientId = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  const key = opts.preferClientId ? (clientId ?? header) : (header ?? clientId);
  return key ? key.slice(0, 200) : null;
}

/** The stored result for this key on this route (replayed with 200), a 409 on cross-route reuse, else null. */
export async function findReplay(
  tx: Tx,
  userId: string,
  key: string | null,
  routeKey: string,
): Promise<HandlerResult | null> {
  if (!key) return null;
  const [prior] = await tx
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
    .limit(1);
  if (!prior) return null;
  if (prior.route !== routeKey) {
    return {
      status: 409,
      body: { error: "Idempotency key already used for another request", code: "idempotency_key_reuse" },
    };
  }
  return { status: 200, body: prior.responseBody };
}

/**
 * Runs `handler` inside the per-user lock and sends its result. Key lookup, the handler's work and the
 * key insert share one transaction, so concurrent same-key requests cannot both apply and a crash cannot
 * lose the key. With an `Idempotency-Key` header (or `clientId` body field) a successful (2xx) result is
 * stored and replayed with 200 on a repeat. Error results are not stored. Requires req.user.
 * With `preferClientId`, a body `clientId` is the key even when a header is sent, so a retry of the same
 * record with a fresh header still replays.
 * Handlers must do all their writes on the given tx.
 */
export async function withIdempotency(
  db: Db,
  req: Request,
  res: Response,
  routeKey: string,
  handler: (tx: Tx) => Promise<HandlerResult>,
  opts: KeyOptions = {},
): Promise<void> {
  const userId = req.user!.id;
  const key = readKey(req, opts);
  const out = await withUserLock(db, userId, async (tx): Promise<HandlerResult> => {
    const replay = await findReplay(tx, userId, key, routeKey);
    if (replay) return replay;
    const result = await handler(tx);
    if (key && result.status >= 200 && result.status < 300) {
      await tx
        .insert(idempotencyKeys)
        .values({ userId, key, route: routeKey, responseStatus: result.status, responseBody: result.body ?? null });
    }
    return result;
  });
  res.status(out.status).json(out.body);
}
