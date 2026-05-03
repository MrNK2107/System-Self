import type { NextFunction, Request, Response } from "express";
import { env, resolveAdminTokens, resolveAuthTokens, resolveRevokedTokens } from "../lib/env";
import { auditAuthEvent, tokenFingerprint } from "../lib/auth-audit";

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
  if (!token) {
    auditAuthEvent(req, "missing_bearer_token");
    return res.status(401).json({ error: "Missing bearer token" });
  }

  const revoked = resolveRevokedTokens();
  if (revoked.has(token)) {
    auditAuthEvent(req, "revoked_token_attempt", { tokenFp: tokenFingerprint(token) });
    return res.status(401).json({ error: "Token revoked" });
  }
  const adminTokens = resolveAdminTokens();
  if (adminTokens.has(token)) {
    auditAuthEvent(req, "admin_token_authenticated", { tokenFp: tokenFingerprint(token) });
    req.auth = { username: "__admin__", token, isAdmin: true };
    return next();
  }

  const tokenMap = resolveAuthTokens();
  const record = tokenMap.get(token);
  if (!record) {
    auditAuthEvent(req, "invalid_token_attempt", { tokenFp: tokenFingerprint(token) });
    return res.status(401).json({ error: "Invalid token" });
  }

  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    auditAuthEvent(req, "expired_token_attempt", {
      tokenFp: tokenFingerprint(token),
      username: record.username,
      expiresAt: record.expiresAt.toISOString(),
    });
    return res.status(401).json({ error: "Token expired" });
  }

  if (record.expiresAt) {
    const msLeft = record.expiresAt.getTime() - Date.now();
    const warnMs = env.AUTH_ROTATION_WARNING_DAYS * 24 * 60 * 60 * 1000;
    if (msLeft > 0 && msLeft <= warnMs) {
      auditAuthEvent(req, "token_expiring_soon", {
        tokenFp: tokenFingerprint(token),
        username: record.username,
        expiresAt: record.expiresAt.toISOString(),
      });
      res.setHeader("X-Auth-Token-Rotation-Warning", "token_expiring_soon");
      res.setHeader("X-Auth-Token-Expires-At", record.expiresAt.toISOString());
    }
  }

  auditAuthEvent(req, "user_token_authenticated", {
    tokenFp: tokenFingerprint(token),
    username: record.username,
  });
  req.auth = { username: record.username, token, isAdmin: false };
  return next();
}

export function requireOwnership(
  req: Request,
  res: Response,
  username: string | null | undefined,
) {
  if (!env.AUTH_ENABLED) return true;
  if (!req.auth) {
    auditAuthEvent(req, "ownership_check_unauthorized");
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  if (req.auth.isAdmin) return true;
  if (!username || username.trim() !== req.auth.username) {
    auditAuthEvent(req, "ownership_forbidden", {
      authUsername: req.auth.username,
      requestedUsername: username ?? null,
    });
    res.status(403).json({ error: "Forbidden for requested username" });
    return false;
  }
  return true;
}
