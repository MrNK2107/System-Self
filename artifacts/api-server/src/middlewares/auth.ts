import { DB_UNAVAILABLE } from "../lib/db-unavailable";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { users, type Db } from "@workspace/db";
import { verifyAccessToken } from "../lib/auth/tokens";

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
}

/**
 * Verifies the bearer access token, loads the user from the database and checks
 * the token version. The role always comes from the database, never from the token.
 * `req.user` is the only source of ownership for downstream handlers.
 */
export function createRequireAuth(db: Db | null): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!db) {
      res.status(503).json(DB_UNAVAILABLE);
      return;
    }
    const deny = (event: string) => {
      req.log.info({ event }, "auth_denied");
      res.status(401).json({ error: "Unauthorized" });
    };

    const token = readBearerToken(req);
    if (!token) return deny("missing_bearer_token");
    const claims = await verifyAccessToken(token);
    if (!claims) return deny("invalid_access_token");

    const [user] = await db
      .select({ id: users.id, role: users.role, username: users.username, tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, claims.userId))
      .limit(1);
    if (!user) return deny("unknown_user");
    if (user.tokenVersion !== claims.ver) return deny("stale_token_version");

    req.user = { id: user.id, role: user.role, username: user.username };
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.user.role !== "admin") {
    req.log.info({ event: "admin_forbidden", userId: req.user.id }, "auth_denied");
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
