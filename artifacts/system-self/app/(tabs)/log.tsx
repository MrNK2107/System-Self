import { Redirect } from "expo-router";
import React from "react";

// The Log tab opens the log sheet (see app/(tabs)/_layout.tsx) and never navigates here; a deep link lands on Today.
export default function LogTab() {
  return <Redirect href="/(tabs)" />;
}
