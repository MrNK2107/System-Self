import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";

export type Role = "user" | "admin";

const ISSUER = "system-self";
const secret = () => new TextEncoder().encode(env.JWT_SECRET);

export function hashToken(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

export async function signAccessToken(
  u: { id: string; role: Role; tokenVersion: number },
  opts?: { ttlSec?: number },
): Promise<{ token: string; expiresAt: Date }> {
  const ttl = opts?.ttlSec ?? env.ACCESS_TOKEN_TTL_SEC;
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + ttl;
  const token = await new SignJWT({ role: u.role, ver: u.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setIssuer(ISSUER)
    .setIssuedAt(nowSec)
    .setExpirationTime(exp)
    .sign(secret());
  return { token, expiresAt: new Date(exp * 1000) };
}

export async function verifyAccessToken(
  token: string,
): Promise<{ userId: string; role: Role; ver: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, algorithms: ["HS256"] });
    const { sub, role, ver } = payload;
    if (typeof sub !== "string" || (role !== "user" && role !== "admin") || typeof ver !== "number") return null;
    return { userId: sub, role, ver };
  } catch {
    return null;
  }
}
