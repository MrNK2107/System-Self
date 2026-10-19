import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Stack, router, useRootNavigationState, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AppProvider } from "@/context/AppContext";
import { GymProvider } from "@/features/gym/context/GymContext";
import { QueryProvider } from "@/lib/api/query";

SplashScreen.preventAutoHideAsync();

// Whenever the session ends (sign-out, expired refresh token, deleted account) leave signed-in screens.
function useSignedOutGuard() {
  const { status } = useAuth();
  const segments = useSegments();
  const navReady = !!useRootNavigationState()?.key;
  const group = segments[0] as string | undefined;

  useEffect(() => {
    if (!navReady || status !== "signed_out") return;
    if (group === "auth" || group === "legal") return;
    router.replace("/auth/sign-in");
  }, [navReady, status, group]);
}

function RootLayoutNav() {
  useSignedOutGuard();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="auth" options={{ gestureEnabled: false }} />
      <Stack.Screen name="legal/[doc]" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="social" />
      <Stack.Screen name="paywall" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="floor/[routineId]" />
      <Stack.Screen name="dungeon/briefing" />
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryProvider>
          <AuthProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <AppProvider>
                  <GymProvider>
                    <RootLayoutNav />
                  </GymProvider>
                </AppProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </AuthProvider>
        </QueryProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
