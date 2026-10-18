import { DB_UNAVAILABLE } from "../lib/db-unavailable";
import { Router, type IRouter, type Request, type RequestHandler } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { users, type Db, type User } from "@workspace/db";
import { hashPassword, verifyPassword } from "../lib/auth/passwords";
import { signAccessToken } from "../lib/auth/tokens";
import {
  issueRefreshToken,
  revokeAllForUser,
  revokeRefreshFamilyByToken,
  rotateRefreshToken,
} from "../lib/auth/refresh";
import { consumeEmailCode, createEmailCode, type CodePurpose } from "../lib/auth/codes";
import { toPublicUser, type PublicUser } from "../lib/auth/public-user";
import type { Mailer } from "../lib/mailer";

const MIN_AGE = 16;

const email = z.string().trim().toLowerCase().email().max(254);
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, "Username must be 3-20 characters: a-z, 0-9, underscore");
const newPassword = z.string().min(10).max(128);
const anyPassword = z.string().min(1).max(128);
const code = z.string().regex(/^\d{6}$/, "Code must be 6 digits");
// Canonical IANA spelling as resolved by the runtime (e.g. "america/new_york" -> "America/New_York").
const timezone = z
  .string()
  .min(1)
  .max(64)
  .transform((tz, ctx) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
    } catch {
      ctx.addIssue({ code: "custom", message: "Unknown timezone" });
      return z.NEVER;
    }
  });

const registerSchema = z.object({
  email,
  password: newPassword,
  username,
  birthYear: z
    .number()
    .int()
    .min(1900)
    .refine((y) => new Date().getFullYear() - y >= MIN_AGE, `You must be at least ${MIN_AGE} years old`),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "Terms must be accepted" }) }),
  timezone: timezone.optional(),
});
const loginSchema = z.object({ email, password: anyPassword });
const refreshSchema = z.object({ refreshToken: z.string().min(1).max(512) });
const patchMeSchema = z.object({ timezone: timezone.optional(), username: username.optional() });
const verifySchema = z.object({ code });
const forgotSchema = z.object({ email });
const resetSchema = z.object({ email, code, newPassword });
const changeSchema = z.object({ currentPassword: anyPassword, newPassword });
const deleteSchema = z.object({ password: anyPassword });

interface AuthResponse {
  user: PublicUser;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
}

// A fixed argon2id hash computed once, so unknown-email logins pay the same verify cost as real ones.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("timing-equalizer-not-a-real-password"));

function uniqueViolation(e: unknown): { constraint: string } | null {
  const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const c = err?.cause?.code ?? err?.code;
  if (c !== "23505") return null;
  return { constraint: err?.cause?.constraint ?? err?.constraint ?? "" };
}

const CODE_ERRORS = {
  invalid: "invalid_code",
  expired: "expired_code",
  locked: "locked",
} as const;

export function authRoutes(deps: { db: Db | null; mailer: Mailer; requireAuth: RequestHandler }): IRouter {
  const { db, mailer, requireAuth } = deps;
  const router = Router();

  router.use("/auth", (_req, res, next) => {
    if (!db) {
      res.status(503).json(DB_UNAVAILABLE);
      return;
    }
    next();
  });

  const database = (): Db => db!;

  // Mail delivery never blocks or fails the request (and does not reveal account existence by timing).
  function sendMail(req: Request, msg: { to: string; subject: string; text: string }) {
    void mailer.send(msg).catch((err) => req.log.error({ err }, "Failed to send email"));
  }

  function sendCode(req: Request, to: string, purpose: CodePurpose, c: string) {
    const verify = purpose === "verify";
    sendMail(req, {
      to,
      subject: verify ? "Verify your SYSTEM // SELF email" : "Reset your SYSTEM // SELF password",
      text: `${verify ? "Your verification code" : "Your password reset code"} is ${c}. It expires in 15 minutes.`,
    });
  }

  async function issueSession(req: Request, user: User, existingRefresh?: { token: string }): Promise<AuthResponse> {
    const access = await signAccessToken({ id: user.id, role: user.role, tokenVersion: user.tokenVersion });
    const refreshToken =
      existingRefresh?.token ??
      (await issueRefreshToken(database(), user.id, { userAgent: req.headers["user-agent"] })).token;
    return {
      user: toPublicUser(user),
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
    };
  }

  async function loadUser(id: string): Promise<User | undefined> {
    const [row] = await database().select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }

  async function bumpAndRevoke(userId: string, passwordHash: string) {
    await database().transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await revokeAllForUser(tx, userId);
    });
  }

  router.post("/auth/register", async (req, res) => {
    const body = registerSchema.parse(req.body);
    const passwordHash = await hashPassword(body.password);
    let user: User;
    let verifyCode: string | null;
    try {
      ({ user, verifyCode } = await database().transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            email: body.email,
            username: body.username,
            passwordHash,
            birthYear: body.birthYear,
            termsAcceptedAt: new Date(),
            ...(body.timezone ? { timezone: body.timezone } : {}),
          })
          .returning();
        return { user: row!, verifyCode: await createEmailCode(tx, row!.id, "verify") };
      }));
    } catch (e) {
      const dup = uniqueViolation(e);
      if (!dup) throw e;
      const field = dup.constraint.includes("username") ? "username" : "email";
      res.status(409).json({
        error: field === "email" ? "Email already registered" : "Username already taken",
        code: `${field}_taken`,
      });
      return;
    }
    if (verifyCode) sendCode(req, user.email, "verify", verifyCode);
    res.status(201).json(await issueSession(req, user));
  });

  router.post("/auth/login", async (req, res) => {
    const body = loginSchema.parse(req.body);
    const [user] = await database().select().from(users).where(eq(users.email, body.email)).limit(1);
    const ok = await verifyPassword(user ? user.passwordHash : await getDummyHash(), body.password);
    if (!user || !ok) {
      req.log.info({ event: "login_failed" }, "auth_denied");
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    res.json(await issueSession(req, user));
  });

  router.post("/auth/refresh", async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    const rotated = await rotateRefreshToken(database(), refreshToken, req.headers["user-agent"]);
    if (!rotated.ok) {
      req.log.info({ event: "refresh_rejected", reason: rotated.reason }, "auth_denied");
      res.status(401).json({ error: "Invalid refresh token", code: "invalid_refresh" });
      return;
    }
    const user = await loadUser(rotated.userId);
    if (!user) {
      res.status(401).json({ error: "Invalid refresh token", code: "invalid_refresh" });
      return;
    }
    res.json(await issueSession(req, user, { token: rotated.token }));
  });

  router.post("/auth/logout", async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    await revokeRefreshFamilyByToken(database(), refreshToken);
    res.status(204).end();
  });

  router.get("/auth/me", requireAuth, async (req, res) => {
    const user = await loadUser(req.user!.id);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json({ user: toPublicUser(user) });
  });

  router.patch("/auth/me", requireAuth, async (req, res) => {
    const body = patchMeSchema.parse(req.body);
    const changes: Partial<Pick<User, "timezone" | "username">> = {};
    if (body.timezone) changes.timezone = body.timezone;
    if (body.username) changes.username = body.username;
    try {
      const [row] = Object.keys(changes).length
        ? await database()
            .update(users)
            .set({ ...changes, updatedAt: new Date() })
            .where(eq(users.id, req.user!.id))
            .returning()
        : [await loadUser(req.user!.id)];
      if (!row) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      res.json({ user: toPublicUser(row) });
    } catch (e) {
      if (!uniqueViolation(e)) throw e;
      res.status(409).json({ error: "Username already taken", code: "username_taken" });
    }
  });

  router.post("/auth/email/verify/request", requireAuth, async (req, res) => {
    const user = await loadUser(req.user!.id);
    if (user && !user.emailVerifiedAt) {
      const c = await createEmailCode(database(), user.id, "verify");
      if (!c) {
        res.status(429).json({ error: "Too many codes requested, try again later", code: "code_rate_limited" });
        return;
      }
      sendCode(req, user.email, "verify", c);
    }
    res.status(204).end();
  });

  router.post("/auth/email/verify", requireAuth, async (req, res) => {
    const body = verifySchema.parse(req.body);
    const result = await consumeEmailCode(database(), req.user!.id, "verify", body.code);
    if (result !== "ok") {
      res.status(400).json({ error: "Verification failed", code: CODE_ERRORS[result] });
      return;
    }
    const [row] = await database()
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, req.user!.id))
      .returning();
    res.json({ user: toPublicUser(row!) });
  });

  router.post("/auth/password/forgot", async (req, res) => {
    const body = forgotSchema.parse(req.body);
    const [user] = await database().select().from(users).where(eq(users.email, body.email)).limit(1);
    if (user) {
      // Over the per-account cap nothing is sent, but the response stays 204 (no account enumeration).
      const c = await createEmailCode(database(), user.id, "reset");
      if (c) sendCode(req, user.email, "reset", c);
    }
    res.status(204).end();
  });

  router.post("/auth/password/reset", async (req, res) => {
    const body = resetSchema.parse(req.body);
    const [user] = await database().select().from(users).where(eq(users.email, body.email)).limit(1);
    const result = user ? await consumeEmailCode(database(), user.id, "reset", body.code) : "invalid";
    if (!user || result !== "ok") {
      res.status(400).json({ error: "Reset failed", code: CODE_ERRORS[result as keyof typeof CODE_ERRORS] });
      return;
    }
    await bumpAndRevoke(user.id, await hashPassword(body.newPassword));
    res.status(204).end();
  });

  router.post("/auth/password/change", requireAuth, async (req, res) => {
    const body = changeSchema.parse(req.body);
    const user = await loadUser(req.user!.id);
    if (!user || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
      res.status(401).json({ error: "Invalid password", code: "invalid_password" });
      return;
    }
    await bumpAndRevoke(user.id, await hashPassword(body.newPassword));
    // Every other session is revoked; the caller gets a fresh one (new tokenVersion) and stays signed in.
    const updated = await loadUser(user.id);
    if (!updated) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json(await issueSession(req, updated));
  });

  router.delete("/auth/account", requireAuth, async (req, res) => {
    const body = deleteSchema.parse(req.body);
    const user = await loadUser(req.user!.id);
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      res.status(401).json({ error: "Invalid password", code: "invalid_password" });
      return;
    }
    await database().delete(users).where(eq(users.id, user.id));
    req.log.info({ event: "account_deleted", userId: user.id }, "auth_event");
    res.status(204).end();
  });

  return router;
}
