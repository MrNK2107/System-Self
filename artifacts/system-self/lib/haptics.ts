// One thin wrapper over expo-haptics. Never throws, and is a no-op on web (no haptic hardware).
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

function run(fn: () => Promise<void>): void {
  if (Platform.OS === "web") return;
  try {
    fn().catch(() => undefined);
  } catch {
    // Haptics are decoration; never let them break a flow.
  }
}

/** A quest was completed. */
export const questCompleteHaptic = () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
/** The rank changed (promotion or demotion). */
export const rankChangeHaptic = () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
/** Shadow Self activated. */
export const shadowActivatedHaptic = () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
/** The nightly verdict was delivered. */
export const verdictHaptic = () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
