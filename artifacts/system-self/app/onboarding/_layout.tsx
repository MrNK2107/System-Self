import { Stack } from "expo-router";

// Order: THE SYSTEM speaks, assessment (rate / objective / weakness), identity, life, schedule, calibration.
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, statusBarStyle: "light", gestureEnabled: false, animation: "fade" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="assessment" />
      <Stack.Screen name="identity" />
      <Stack.Screen name="life" />
      <Stack.Screen name="schedule" />
      {/* Calibration submits the answers; it leaves by replace, so nothing returns to it. */}
      <Stack.Screen name="calibrating" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
