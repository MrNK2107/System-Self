import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import { TextInput } from "react-native";

import { AuthField } from "@/components/AuthField";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { useAuth } from "@/context/AuthContext";
import { describeAuthError, isRetryable, validateNewPassword } from "@/lib/auth/actions";

export default function ResetScreen() {
  const { resetPassword, requestPasswordReset } = useAuth();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === "string" ? params.email : "";
  const passwordRef = useRef<TextInput>(null);

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);
  const [resent, setResent] = useState(false);

  const canSubmit = /^\d{6}$/.test(code) && password.length > 0;

  const submit = async () => {
    if (busy || !canSubmit) return;
    const pwError = validateNewPassword(password);
    setPasswordError(pwError);
    setError(null);
    if (pwError) return;
    setBusy(true);
    try {
      await resetPassword(email, code, password);
      router.replace({ pathname: "/auth/sign-in", params: { reset: "1" } });
    } catch (e) {
      setError({ message: describeAuthError(e, "reset").message, retry: isRetryable(e) });
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setResent(false);
    try {
      await requestPasswordReset(email);
      setResent(true);
    } catch (e) {
      setError({ message: describeAuthError(e, "forgot").message, retry: false });
    }
  };

  if (!email) {
    return (
      <AuthShell tag="RECOVERY" title="START OVER." subtitle="No email on record for this reset." back>
        <AuthButton label="REQUEST A CODE" onPress={() => router.replace("/auth/forgot")} />
      </AuthShell>
    );
  }

  return (
    <AuthShell tag="RECOVERY" title="ENTER THE CODE." subtitle={`Sent to ${email}. It expires in 15 minutes.`} back>
      <AuthField
        label="SIX-DIGIT CODE"
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, ""))}
        mono
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        placeholder="000000"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        blurOnSubmit={false}
      />
      <AuthField
        ref={passwordRef}
        label="NEW PASSWORD"
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          setPasswordError(null);
        }}
        error={passwordError}
        hint="At least 10 characters."
        secret
        autoComplete="new-password"
        textContentType="newPassword"
        maxLength={128}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {error ? <AuthNotice message={error.message} onRetry={error.retry ? submit : undefined} /> : null}
      {resent && !error ? <AuthNotice tone="info" message="A new code is on its way." /> : null}
      <AuthButton label="SET NEW PASSWORD" onPress={submit} loading={busy} disabled={!canSubmit} />
      <AuthLink label="SEND A NEW CODE" onPress={resend} />
    </AuthShell>
  );
}
