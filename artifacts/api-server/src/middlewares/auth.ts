import type { NextFunction, Request, Response } from "express";
import { env, resolveAuthTokenMap } from "../lib/env";

const tokenMap = resolveAuthTokenMap();

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!env.AUTH_ENABLED) return next();

  // Health and readiness remain public.
  if (req.path.endsWith("/healthz") || req.path.endsWith("/readyz")) return next();

  const token = readBearerToken(req);
  if (!token) return res.status(401).json({ error: "Missing bearer token" });

  const username = tokenMap.get(token);
  if (!username) return res.status(401).json({ error: "Invalid token" });

  req.auth = { username, token };
  return next();
}

export function requireOwnership(
  req: Request,
  res: Response,
  username: string | null | undefined,
) {
  if (!env.AUTH_ENABLED) return true;
  if (!req.auth) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (!username || username.trim() !== req.auth.username) {
    res.status(403).json({ error: "Forbidden for requested username" });
    return false;
  }
  return true;
}
