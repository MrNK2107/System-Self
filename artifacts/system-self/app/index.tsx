import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { api } from "@/lib/api/client";
import { fetchOnboardingStatus, onboardingStatusKey } from "@/lib/auth/actions";

export default function Index() {
  const { status, user } = useAuth();
  const colors = useColors();

  // Cached across launches (query persistence), so an offline start still routes correctly.
  const onboarding = useQuery({
    queryKey: onboardingStatusKey(user?.id ?? null),
    queryFn: () => fetchOnboardingStatus(api),
    enabled: status === "signed_in",
  });

  const splash = (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );

  if (status === "loading") return splash;
  if (status === "signed_out") return <Redirect href="/auth/sign-in" />;

  if (onboarding.data === "not_onboarded") return <Redirect href="/onboarding" />;
  if (onboarding.data === "onboarded") return <Redirect href="/(tabs)" />;

  if (onboarding.isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.message, { color: colors.mutedForeground }]}>
          The System is out of reach. Check your connection.
        </Text>
        <TouchableOpacity onPress={() => void onboarding.refetch()} accessibilityRole="button" style={styles.retry}>
          <Text style={[styles.retryText, { color: colors.primary }]}>RETRY</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return splash;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 32 },
  message: { fontSize: 13, lineHeight: 20, textAlign: "center" },
  retry: { paddingVertical: 8, paddingHorizontal: 16 },
  retryText: { fontSize: 11, fontWeight: "700", letterSpacing: 3 },
});
