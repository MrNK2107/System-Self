import { router } from "expo-router";
import React, { useState } from "react";

import { AuthField } from "@/components/AuthField";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { useAuth } from "@/context/AuthContext";
import { describeAuthError, isRetryable, normalizeEmail } from "@/lib/auth/actions";

export default function ForgotScreen() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async () => {
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      router.push({ pathname: "/auth/reset", params: { email: normalizeEmail(email) } });
    } catch (e) {
      setError({ message: describeAuthError(e, "forgot").message, retry: isRetryable(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      tag="RECOVERY"
      title="LOCKED OUT."
      subtitle="Enter your email. If an account exists, a six-digit code is on its way."
      back
    >
      <AuthField
        label="EMAIL"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="username"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {error ? <AuthNotice message={error.message} onRetry={error.retry ? submit : undefined} /> : null}
      <AuthButton label="SEND CODE" onPress={submit} loading={busy} disabled={!valid} />
      <AuthLink label="BACK TO SIGN IN" onPress={() => router.replace("/auth/sign-in")} />
    </AuthShell>
  );
}
