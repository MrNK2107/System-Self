// Network logic behind the settings screens. No React Native imports, so tests and the smoke script reuse it.
import { z } from "zod";
import type { LifeContext } from "@workspace/contracts";
import { ApiError, type ApiClient } from "../api/client";
import { AuthResponseSchema, PublicUserSchema, type PublicUser, type TokenStore } from "../api/session";
import { PROFILE_SCHEMA, type Profile, type ScheduleTimes } from "../onboarding/actions";
import { validateNewPassword } from "../auth/actions";

export type IdentitySetting = Profile["identitySetting"];

const VerifyResponseSchema = z.object({ user: PublicUserSchema });

export interface SettingsActionDeps {
  api: ApiClient;
  tokens: TokenStore;
  /** Wipes the query cache, outbox and the given user's persisted gym session. */
  clearLocalData: (userId?: string) => Promise<void>;
}

export function createSettingsActions(deps: SettingsActionDeps) {
  const { api, tokens } = deps;

  return {
    updateSchedule(times: ScheduleTimes): Promise<Profile> {
      return api.request("PATCH", "/api/profile", { body: times, schema: PROFILE_SCHEMA });
    },

    updateIdentity(identitySetting: IdentitySetting): Promise<Profile> {
      return api.request("PATCH", "/api/profile", { body: { identitySetting }, schema: PROFILE_SCHEMA });
    },

    updateLifeContext(lifeContext: LifeContext): Promise<Profile> {
      return api.request("PATCH", "/api/profile", { body: { lifeContext }, schema: PROFILE_SCHEMA });
    },

    /** Sends a verification code to the account email. 429 code_rate_limited when requested too often. */
    async requestEmailVerification(): Promise<void> {
      await api.request("POST", "/api/auth/email/verify/request");
    },

    /** Confirms the emailed code and keeps the stored session's user in step. */
    async verifyEmail(code: string): Promise<PublicUser> {
      const { user } = await api.request("POST", "/api/auth/email/verify", {
        body: { code: code.trim() },
        schema: VerifyResponseSchema,
      });
      const current = await tokens.get();
      if (current && current.user.id === user.id) await tokens.set({ ...current, user });
      return user;
    },

    /** Every old token is revoked server-side; the response is the new session, which replaces the stored one. */
    async changePassword(currentPassword: string, newPassword: string): Promise<PublicUser> {
      const session = await api.request("POST", "/api/auth/password/change", {
        body: { currentPassword, newPassword },
        schema: AuthResponseSchema,
      });
      await tokens.set(session);
      return session.user;
    },

    /**
     * DELETE /api/auth/account. Only after the server confirms: wipe local data (while the session still names
     * the user), then drop the session even when the wipe fails. A wrong password leaves everything untouched.
     */
    async deleteAccount(password: string): Promise<void> {
      const userId = (await tokens.get())?.user.id;
      await api.request("DELETE", "/api/auth/account", { body: { password } });
      try {
        await deps.clearLocalData(userId);
      } finally {
        await tokens.set(null);
      }
    },

    /** Everything the server stores about the user, as pretty JSON text ready to save or share. 429 after a few calls an hour. */
    async exportMyData(now: Date = new Date()): Promise<{ filename: string; text: string }> {
      const body = await api.request<unknown>("GET", "/api/account/export", { timeoutMs: 60_000 });
      return { filename: `system-self-export-${now.toISOString().slice(0, 10)}.json`, text: JSON.stringify(body, null, 2) };
    },
  };
}

export type SettingsActions = ReturnType<typeof createSettingsActions>;

export function validatePasswordChange(current: string, next: string): string | null {
  if (!current) return "Enter your current password.";
  const problem = validateNewPassword(next);
  if (problem) return problem;
  if (current === next) return "Choose a different password.";
  return null;
}

export type SettingsErrorContext = "schedule" | "identity" | "verify-request" | "verify" | "password" | "delete" | "export";

const CODE_MESSAGES: Record<string, string> = {
  invalid_code: "That code is incorrect.",
  expired_code: "That code has expired. Request a new one.",
  locked: "Too many wrong codes. Request a new one.",
};

export function describeSettingsError(err: unknown, context: SettingsErrorContext): { message: string } {
  if (!(err instanceof ApiError)) return { message: "Something broke. Retry." };
  if (err.kind === "network") return { message: "No connection. Check your signal and retry." };
  if (err.kind !== "http") return { message: "The system is unavailable. Retry shortly." };

  const status = err.status ?? 0;
  if (err.code === "code_rate_limited") return { message: "Too many codes requested. Try again later." };
  if (status === 429 && context === "export") return { message: "You can export a few times an hour. Try again later." };
  if (status === 429) return { message: "Too many attempts. Wait a moment, then retry." };
  if (status >= 500) return { message: "The system is unavailable. Retry shortly." };
  if (err.code === "invalid_password") return { message: "That password is incorrect." };
  if (context === "verify" && err.code && CODE_MESSAGES[err.code]) return { message: CODE_MESSAGES[err.code]! };
  if (status === 400) {
    const first = err.issues[0]?.message;
    return { message: first ? `Rejected: ${first}` : "Those details were rejected. Check them and retry." };
  }
  return { message: "Something broke. Retry." };
}
