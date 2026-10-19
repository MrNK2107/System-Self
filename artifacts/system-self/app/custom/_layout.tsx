import { Stack } from "expo-router";
import React from "react";

export default function CustomLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
