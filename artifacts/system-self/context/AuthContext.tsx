import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { api, onSessionExpired } from "@/lib/api/client";
import { clearLocalData, handleSignIn } from "@/lib/api/query";
import { secureTokenStore, type PublicUser } from "@/lib/api/session";
import { createAuthActions, type SignUpInput } from "@/lib/auth/actions";

export type AuthStatus = "loading" | "signed_out" | "signed_in";

export interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(email: string, code: string, newPassword: string): Promise<void>;
  refreshUser(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const actions = createAuthActions({ api, tokens: secureTokenStore, handleSignIn, clearLocalData });

/** The device timezone as the runtime reports it (canonicalised by the server). */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<PublicUser | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const signedOut = useCallback(() => {
    if (!mounted.current) return;
    setUser(null);
    setStatus("signed_out");
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const fresh = await actions.fetchMe();
      if (mounted.current) setUser(fresh);
    } catch {
      // Offline or a transient failure keeps the stored user. A dead session reaches us through onSessionExpired.
    }
  }, []);

  // Restore the stored session. A stored session counts as signed in even offline; the next request validates it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await secureTokenStore.get();
        if (cancelled) return;
        if (!session) {
          signedOut();
          return;
        }
        setUser(session.user);
        setStatus("signed_in");
        void refreshUser();
      } catch {
        if (!cancelled) signedOut();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshUser, signedOut]);

  // The refresh token was rejected (expired, revoked, account deleted elsewhere). Local data stays for a same-user re-login.
  useEffect(() => onSessionExpired(signedOut), [signedOut]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      async signIn(email, password) {
        const u = await actions.signIn(email, password);
        setUser(u);
        setStatus("signed_in");
      },
      async signUp(input) {
        const u = await actions.signUp(input);
        setUser(u);
        setStatus("signed_in");
      },
      async signOut() {
        try {
          await actions.signOut();
        } finally {
          // The session is cleared even when the local wipe failed, so the UI must leave signed-in screens too.
          signedOut();
        }
      },
      requestPasswordReset: actions.requestPasswordReset,
      resetPassword: actions.resetPassword,
      refreshUser,
    }),
    [status, user, signedOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
