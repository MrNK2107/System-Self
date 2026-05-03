import crypto from "node:crypto";
import type { Request } from "express";

export function tokenFingerprint(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function auditAuthEvent(
  req: Request,
  event: string,
  details: Record<string, unknown> = {},
) {
  req.log.warn(
    {
      security: {
        event,
        method: req.method,
        path: req.path,
        ip:
          req.ip ||
          (Array.isArray(req.headers["x-forwarded-for"])
            ? req.headers["x-forwarded-for"][0]
            : req.headers["x-forwarded-for"]) ||
          null,
        userAgent: req.headers["user-agent"] || null,
        ...details,
      },
    },
    `auth_audit:${event}`,
  );
}

