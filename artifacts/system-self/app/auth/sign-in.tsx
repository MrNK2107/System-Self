import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import { TextInput, View } from "react-native";

import { AuthField } from "@/components/AuthField";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { useAuth } from "@/context/AuthContext";
import { describeAuthError, isRetryable } from "@/lib/auth/actions";

export default function SignInScreen() {
  const { signIn } = useAuth();
  const { reset } = useLocalSearchParams<{ reset?: string }>();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0;

  const submit = async () => {
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      router.replace("/");
    } catch (e) {
      setError({ message: describeAuthError(e, "sign_in").message, retry: isRetryable(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell tag="SYSTEM // SELF" title="SIGN IN." subtitle="The System has been waiting.">
      {reset === "1" && !error ? <AuthNotice tone="info" message="Password updated. Sign in." /> : null}
      <AuthField
        label="EMAIL"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        blurOnSubmit={false}
      />
      <AuthField
        ref={passwordRef}
        label="PASSWORD"
        value={password}
        onChangeText={setPassword}
        secret
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {error ? <AuthNotice message={error.message} onRetry={error.retry ? submit : undefined} /> : null}
      <AuthButton label="SIGN IN" onPress={submit} loading={busy} disabled={!canSubmit} />
      <View>
        <AuthLink label="FORGOT PASSWORD" onPress={() => router.push("/auth/forgot")} />
        <AuthLink label="NO ACCOUNT. CREATE ONE" onPress={() => router.push("/auth/sign-up")} />
      </View>
    </AuthShell>
  );
}
