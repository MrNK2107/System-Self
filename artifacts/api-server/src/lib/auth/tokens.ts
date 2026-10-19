import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";

export type Role = "user" | "admin";

const ISSUER = "system-self";
const encode = (s: string) => new TextEncoder().encode(s);

/** Signing key, plus the key being rotated out (verification only). */
export type AccessTokenSecrets = { current: string; previous?: string };

export function accessTokenSecrets(): AccessTokenSecrets {
  return { current: env.JWT_SECRET, previous: env.JWT_SECRET_PREVIOUS };
}

export function hashToken(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

/** Always signed with the current JWT_SECRET (`secret` is a test seam). `now` is injectable for tests. */
export async function signAccessToken(
  u: { id: string; role: Role; tokenVersion: number },
  opts?: { ttlSec?: number; now?: Date; secret?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const ttl = opts?.ttlSec ?? env.ACCESS_TOKEN_TTL_SEC;
  const nowSec = Math.floor((opts?.now ?? new Date()).getTime() / 1000);
  const exp = nowSec + ttl;
  const token = await new SignJWT({ role: u.role, ver: u.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setIssuer(ISSUER)
    .setIssuedAt(nowSec)
    .setExpirationTime(exp)
    .sign(encode(opts?.secret ?? env.JWT_SECRET));
  return { token, expiresAt: new Date(exp * 1000) };
}

/**
 * Verifies signature, issuer and expiry, against JWT_SECRET and then JWT_SECRET_PREVIOUS (rotation window).
 * The returned `role` is only what was true when the token was signed: never use it for authorization.
 * requireAuth reloads the role (and tokenVersion) from the database on every request.
 */
export async function verifyAccessToken(
  token: string,
  opts?: { now?: Date; secrets?: AccessTokenSecrets },
): Promise<{ userId: string; role: Role; ver: number } | null> {
  const { current, previous } = opts?.secrets ?? accessTokenSecrets();
  for (const key of previous && previous !== current ? [current, previous] : [current]) {
    try {
      const { payload } = await jwtVerify(token, encode(key), {
        issuer: ISSUER,
        algorithms: ["HS256"],
        currentDate: opts?.now,
      });
      const { sub, role, ver } = payload;
      if (typeof sub !== "string" || (role !== "user" && role !== "admin") || typeof ver !== "number") return null;
      return { userId: sub, role, ver };
    } catch {
      // Wrong key, expired or malformed: try the next key, if any.
    }
  }
  return null;
}
