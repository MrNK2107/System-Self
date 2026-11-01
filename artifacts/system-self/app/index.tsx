import { useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { space, type } from "@/constants/type";
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
  if (status === "signed_out") return <Redirect href="/auth/welcome" />;

  if (onboarding.data === "not_onboarded") return <Redirect href="/onboarding" />;
  if (onboarding.data === "onboarded") return <Redirect href="/(tabs)" />;

  if (onboarding.isError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[type.body, styles.message, { color: colors.foreground }]}>
          The System is out of reach. Check your connection.
        </Text>
        <Button label="Retry" variant="tonal" onPress={() => void onboarding.refetch()} />
      </View>
    );
  }

  return splash;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl },
  message: { textAlign: "center" },
});
