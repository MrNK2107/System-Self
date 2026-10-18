import { z } from "zod";

// PublicUser mirrors artifacts/api-server/src/lib/auth/public-user.ts (not part of @workspace/contracts).
export const PublicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string(),
  role: z.enum(["user", "admin"]),
  emailVerified: z.boolean(),
  timezone: z.string(),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

// Response of register / login / refresh / password change.
export const AuthResponseSchema = z.object({
  user: PublicUserSchema,
  accessToken: z.string(),
  accessTokenExpiresAt: z.string(),
  refreshToken: z.string(),
});
export type Session = z.infer<typeof AuthResponseSchema>;

export interface TokenStore {
  get(): Promise<Session | null>;
  set(s: Session | null): Promise<void>;
}

const SESSION_KEY = "system_self.session";

type SecureStoreModule = typeof import("expo-secure-store");

// expo-secure-store is required lazily so this module stays importable under plain node (tests, smoke script).
function secureStore(): SecureStoreModule {
  return require("expo-secure-store") as SecureStoreModule;
}

export const secureTokenStore: TokenStore = {
  async get() {
    const store = secureStore();
    const raw = await store.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed = AuthResponseSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  },
  async set(s) {
    const store = secureStore();
    if (s === null) await store.deleteItemAsync(SESSION_KEY);
    else await store.setItemAsync(SESSION_KEY, JSON.stringify(s));
  },
};
