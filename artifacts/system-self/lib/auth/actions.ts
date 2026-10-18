// Network logic behind AuthContext. No React Native imports, so tests and the smoke script reuse it.
import { z } from "zod";
import { ApiError, type ApiClient } from "../api/client";
import { AuthResponseSchema, PublicUserSchema, type PublicUser, type Session, type TokenStore } from "../api/session";

export const MIN_AGE = 16;
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SignUpInput {
  email: string;
  password: string;
  username: string;
  birthYear: number;
  acceptTerms: true;
  timezone: string;
}

export interface AuthActionDeps {
  api: ApiClient;
  tokens: TokenStore;
  /** Wipes local data when the account on this device changed. Runs before the new session is stored. */
  handleSignIn: (userId: string) => Promise<void>;
  /** Wipes the query cache and outbox. Runs on explicit sign-out before the session is cleared. */
  clearLocalData: () => Promise<void>;
}

const MeSchema = z.object({ user: PublicUserSchema });

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function createAuthActions(deps: AuthActionDeps) {
  const { api, tokens } = deps;

  async function adopt(session: Session): Promise<PublicUser> {
    await deps.handleSignIn(session.user.id);
    await tokens.set(session);
    return session.user;
  }

  return {
    async signIn(email: string, password: string): Promise<PublicUser> {
      const session = await api.request("POST", "/api/auth/login", {
        auth: false,
        schema: AuthResponseSchema,
        body: { email: normalizeEmail(email), password },
      });
      return adopt(session);
    },

    async signUp(input: SignUpInput): Promise<PublicUser> {
      const session = await api.request("POST", "/api/auth/register", {
        auth: false,
        schema: AuthResponseSchema,
        body: {
          email: normalizeEmail(input.email),
          password: input.password,
          username: input.username.trim().toLowerCase(),
          birthYear: input.birthYear,
          acceptTerms: input.acceptTerms,
          ...(input.timezone ? { timezone: input.timezone } : {}),
        },
      });
      return adopt(session);
    },

    /** Best-effort server logout, then local wipe, then the session. Never throws on a network failure. */
    async signOut(): Promise<void> {
      let refreshToken: string | null = null;
      try {
        refreshToken = (await tokens.get())?.refreshToken ?? null;
      } catch {
        refreshToken = null;
      }
      if (refreshToken) {
        try {
          await api.request("POST", "/api/auth/logout", { auth: false, body: { refreshToken } });
        } catch {
          // Offline or server down: the refresh token stays valid server-side until it expires; the device forgets it anyway.
        }
      }
      await deps.clearLocalData();
      await tokens.set(null);
    },

    async requestPasswordReset(email: string): Promise<void> {
      await api.request("POST", "/api/auth/password/forgot", { auth: false, body: { email: normalizeEmail(email) } });
    },

    async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
      await api.request("POST", "/api/auth/password/reset", {
        auth: false,
        body: { email: normalizeEmail(email), code: code.trim(), newPassword },
      });
    },

    /** Current account from the server; keeps the stored session's user in step. */
    async fetchMe(): Promise<PublicUser> {
      const { user } = await api.request("GET", "/api/auth/me", { schema: MeSchema });
      const current = await tokens.get();
      if (current && current.user.id === user.id) await tokens.set({ ...current, user });
      return user;
    },
  };
}

export type AuthActions = ReturnType<typeof createAuthActions>;

// --- onboarding status (used by the routing gate) -----------------------------------------------

export type OnboardingStatus = "onboarded" | "not_onboarded";

export const onboardingStatusKey = (userId: string | null) => ["onboarding-status", userId] as const;

/** GET /api/state: 404 not_onboarded means onboarding is still due; any other failure propagates. */
export async function fetchOnboardingStatus(api: ApiClient): Promise<OnboardingStatus> {
  try {
    await api.request("GET", "/api/state");
    return "onboarded";
  } catch (e) {
    if (e instanceof ApiError && e.kind === "http" && e.status === 404 && e.code === "not_onboarded") {
      return "not_onboarded";
    }
    throw e;
  }
}

// --- validation and error copy ------------------------------------------------------------------

export interface SignUpDraft {
  email: string;
  password: string;
  username: string;
  birthYear: string;
  acceptTerms: boolean;
}

export type SignUpField = keyof SignUpDraft;

export function validateSignUp(d: SignUpDraft, now: Date = new Date()): Partial<Record<SignUpField, string>> {
  const errors: Partial<Record<SignUpField, string>> = {};
  if (!EMAIL_PATTERN.test(d.email.trim())) errors.email = "Enter a valid email.";
  if (d.password.length < 10) errors.password = "Use at least 10 characters.";
  else if (d.password.length > 128) errors.password = "Use at most 128 characters.";
  if (!USERNAME_PATTERN.test(d.username.trim().toLowerCase())) {
    errors.username = "3 to 20 characters: a-z, 0-9, underscore.";
  }
  if (!/^\d{4}$/.test(d.birthYear)) errors.birthYear = "Enter a four-digit year.";
  else {
    const year = Number(d.birthYear);
    if (year < 1900) errors.birthYear = "Enter a four-digit year.";
    else if (now.getFullYear() - year < MIN_AGE) errors.birthYear = "You must be 16 or older.";
  }
  if (!d.acceptTerms) errors.acceptTerms = "Accept the terms to continue.";
  return errors;
}

export function validateNewPassword(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 128) return "Use at most 128 characters.";
  return null;
}

export type AuthErrorContext = "sign_in" | "sign_up" | "forgot" | "reset";

export interface AuthErrorInfo {
  message: string;
  /** Set when the message belongs under one sign-up field. */
  field?: "email" | "username";
}

const CODE_MESSAGES: Record<string, string> = {
  invalid_code: "That code is incorrect.",
  expired_code: "That code has expired. Request a new one.",
  locked: "Too many wrong codes. Request a new one.",
};

export function describeAuthError(err: unknown, context: AuthErrorContext): AuthErrorInfo {
  if (!(err instanceof ApiError)) return { message: "Something broke. Retry." };
  if (err.kind === "network") return { message: "No connection. Check your signal and retry." };
  if (err.kind !== "http") return { message: "The system is unavailable. Retry shortly." };

  const status = err.status ?? 0;
  if (status === 429) return { message: "Too many attempts. Wait a moment, then retry." };
  if (status >= 500) return { message: "The system is unavailable. Retry shortly." };

  if (context === "sign_in" && status === 401) return { message: "Invalid email or password." };
  if (context === "sign_up") {
    if (err.code === "email_taken") return { message: "That email is already registered.", field: "email" };
    if (err.code === "username_taken") return { message: "That codename is taken.", field: "username" };
  }
  if (context === "reset" && err.code && CODE_MESSAGES[err.code]) return { message: CODE_MESSAGES[err.code]! };
  if (status === 400) return { message: "Those details were rejected. Check them and retry." };
  return { message: "Something broke. Retry." };
}

/** True for failures a plain retry can fix: no connection, server trouble, rate limiting. */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.kind !== "http") return true;
  const status = err.status ?? 0;
  return status >= 500 || status === 429;
}
