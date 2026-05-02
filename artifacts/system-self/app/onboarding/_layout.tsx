import { Stack } from "expo-router";

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false, animation: "fade" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="assessment" />
      <Stack.Screen name="identity" />
      <Stack.Screen name="calibrating" />
      <Stack.Screen name="schedule" />
    </Stack>
  );
}
