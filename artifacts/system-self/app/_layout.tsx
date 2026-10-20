import {
  ChakraPetch_500Medium,
  ChakraPetch_600SemiBold,
  ChakraPetch_700Bold,
  useFonts,
} from "@expo-google-fonts/chakra-petch";
import { NotoSans_400Regular, NotoSans_600SemiBold } from "@expo-google-fonts/noto-sans";
import { Stack, router, useRootNavigationState, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { NotificationPrompt } from "@/components/NotificationPrompt";
import { SystemEchoProvider } from "@/components/ui/SystemEcho";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AppProvider } from "@/context/AppContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { GymProvider } from "@/features/gym/context/GymContext";
import { useNotificationSync } from "@/hooks/useNotifications";
import { QueryProvider } from "@/lib/api/query";

SplashScreen.preventAutoHideAsync();

// Expo Go on Android (SDK 53+) logs this as an error when expo-notifications loads, although local reminders still
// work there and remote push only matters in store builds. Hide that one known dev-only toast; nothing else.
if (__DEV__) LogBox.ignoreLogs(["expo-notifications: Android Push notifications"]);

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
  useNotificationSync();
  return (
    <>
      <Stack screenOptions={{ headerShown: false, statusBarStyle: "light" }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth" options={{ gestureEnabled: false }} />
        <Stack.Screen name="legal/[doc]" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="social" />
        <Stack.Screen name="paywall" />
        <Stack.Screen name="clan" />
        <Stack.Screen name="challenges" />
        <Stack.Screen name="duo/index" />
        <Stack.Screen name="finance" />
        <Stack.Screen name="custom" />
        <Stack.Screen name="recap" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="floor/[routineId]" />
        <Stack.Screen name="dungeon/briefing" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      </Stack>
      <NotificationPrompt />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ChakraPetch_500Medium,
    ChakraPetch_600SemiBold,
    ChakraPetch_700Bold,
    NotoSans_400Regular,
    NotoSans_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      {/* Dark app, light status-bar icons everywhere (modals included). */}
      <StatusBar style="light" />
      <ErrorBoundary>
        <QueryProvider>
          <AuthProvider>
            <ThemeProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <SystemEchoProvider>
                <AppProvider>
                  <GymProvider>
                    <RootLayoutNav />
                  </GymProvider>
                </AppProvider>
                </SystemEchoProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
            </ThemeProvider>
          </AuthProvider>
        </QueryProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
