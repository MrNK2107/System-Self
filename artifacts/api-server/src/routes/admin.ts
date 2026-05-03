import { Router } from "express";
import crypto from "node:crypto";
import { env, resolveAdminTokens, resolveAuthTokens, resolveRevokedTokens } from "../lib/env";
import { auditAuthEvent, tokenFingerprint } from "../lib/auth-audit";

const router = Router();

function fingerprint(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
}

router.get("/admin/auth/tokens", (req, res) => {
  if (env.AUTH_ENABLED && !req.auth?.isAdmin) {
    auditAuthEvent(req, "admin_endpoint_forbidden", {
      endpoint: "/admin/auth/tokens",
      authUsername: req.auth?.username ?? null,
      hasAuth: Boolean(req.auth),
    });
    return res.status(403).json({ error: "Admin token required" });
  }
  if (req.auth?.token) {
    auditAuthEvent(req, "admin_endpoint_access", {
      endpoint: "/admin/auth/tokens",
      tokenFp: tokenFingerprint(req.auth.token),
    });
  }

  const authTokens = resolveAuthTokens();
  const revoked = resolveRevokedTokens();
  const adminTokens = resolveAdminTokens();
  const now = Date.now();
  const warnMs = env.AUTH_ROTATION_WARNING_DAYS * 24 * 60 * 60 * 1000;

  const userTokens = Array.from(authTokens.entries()).map(([token, record]) => {
    const expiresAt = record.expiresAt ? record.expiresAt.toISOString() : null;
    const isExpired = record.expiresAt ? record.expiresAt.getTime() <= now : false;
    const expiringSoon = record.expiresAt
      ? record.expiresAt.getTime() > now && record.expiresAt.getTime() - now <= warnMs
      : false;
    return {
      fingerprint: fingerprint(token),
      username: record.username,
      expiresAt,
      isExpired,
      expiringSoon,
      isRevoked: revoked.has(token),
      tokenType: "user",
    };
  });

  const adminTokenRows = Array.from(adminTokens.values()).map((token) => ({
    fingerprint: fingerprint(token),
    username: "__admin__",
    expiresAt: null,
    isExpired: false,
    expiringSoon: false,
    isRevoked: revoked.has(token),
    tokenType: "admin",
  }));

  return res.json({
    authEnabled: env.AUTH_ENABLED,
    rotationWarningDays: env.AUTH_ROTATION_WARNING_DAYS,
    totals: {
      userTokens: userTokens.length,
      adminTokens: adminTokenRows.length,
      revokedTokens: revoked.size,
      expiringSoon: userTokens.filter((t) => t.expiringSoon).length,
      expired: userTokens.filter((t) => t.isExpired).length,
    },
    tokens: [...userTokens, ...adminTokenRows],
  });
});

export default router;
