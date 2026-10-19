// Notifications on the device: permission, the local morning/nightly reminders and the Expo push token.
// expo-notifications is required lazily inside functions and every call is guarded, so a missing native module (web)
// or an Expo Go limitation can never crash the app. Local reminders are the primary path and work in Expo Go.
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Linking, Platform } from "react-native";
import { NotificationPrefsSchema, type NotificationPrefs } from "@workspace/contracts";
import type { ApiClient } from "./api/client";
import {
  ourScheduledIds,
  permissionAction,
  planReminders,
  pushRegistrationDecision,
  type PermissionAction,
  type PlanInput,
  unregisterTokenRequest,
} from "./notifications-core";

type Native = typeof import("expo-notifications");
type DeviceModule = typeof import("expo-device");

const PUSH_TOKEN_KEY = "system_self.push_token";
const promptedKey = (userId: string) => `system_self.notif_prompted.${userId}`;
const CHANNEL_ID = "system-self";

export const notificationPrefsKey = (userId: string | null) => ["notification-prefs", userId] as const;

export const fetchNotificationPrefs = (api: ApiClient): Promise<NotificationPrefs> =>
  api.request("GET", "/api/notifications/prefs", { schema: NotificationPrefsSchema });

export const updateNotificationPrefs = (api: ApiClient, patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> =>
  api.request("PUT", "/api/notifications/prefs", { body: patch, schema: NotificationPrefsSchema });

function loadNative(): Native | null {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-notifications") as Native;
  } catch {
    return null;
  }
}

function loadDevice(): DeviceModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-device") as DeviceModule;
  } catch {
    return null;
  }
}

let configured = false;
async function configure(N: Native): Promise<void> {
  if (configured) return;
  configured = true;
  // Foreground notices show as a banner; never a sound, never a badge count.
  N.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  if (Platform.OS === "android") {
    await N.setNotificationChannelAsync(CHANNEL_ID, { name: "SYSTEM", importance: N.AndroidImportance.DEFAULT });
  }
}

/** Root-mount setup: foreground handler and Android channel. Never prompts for permission. Safe to call repeatedly. */
export async function initNotifications(): Promise<void> {
  const N = loadNative();
  if (!N) return;
  try {
    await configure(N);
  } catch {
    configured = false;
  }
}

export interface PermissionState {
  status: "granted" | "denied" | "undetermined";
  canAskAgain: boolean;
}

export async function getPermissionState(): Promise<PermissionState> {
  const N = loadNative();
  if (!N) return { status: "denied", canAskAgain: false };
  try {
    const p = await N.getPermissionsAsync();
    return { status: p.granted ? "granted" : p.status === "undetermined" ? "undetermined" : "denied", canAskAgain: p.canAskAgain };
  } catch {
    return { status: "denied", canAskAgain: false };
  }
}

/** Shows the OS dialog. Call only after the in-app SYSTEM explanation. */
export async function requestPermission(): Promise<PermissionState> {
  const N = loadNative();
  if (!N) return { status: "denied", canAskAgain: false };
  try {
    await configure(N);
    await N.requestPermissionsAsync();
  } catch {
    // fall through to the real state
  }
  const state = await getPermissionState();
  for (const cb of permissionListeners) cb();
  return state;
}

const permissionListeners = new Set<() => void>();
/** Called after the permission was requested here, so reminders and the token can be set up at once. */
export function onPermissionRequested(cb: () => void): () => void {
  permissionListeners.add(cb);
  return () => void permissionListeners.delete(cb);
}

export const openOsSettings = (): Promise<void> => Linking.openSettings().catch(() => undefined);

export async function wasPrompted(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(promptedKey(userId))) === "1";
  } catch {
    return false;
  }
}

export async function markPrompted(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(promptedKey(userId), "1");
  } catch {
    // The prompt may show once more; harmless.
  }
}

/** What the app should do about the permission for this user right now. */
export async function currentPermissionAction(userId: string): Promise<PermissionAction> {
  const [state, alreadyPrompted] = await Promise.all([getPermissionState(), wasPrompted(userId)]);
  return permissionAction({ ...state, alreadyPrompted });
}

/** Cancels only the reminders this app scheduled (never anything else's). */
export async function cancelOurReminders(): Promise<void> {
  const N = loadNative();
  if (!N) return;
  try {
    const scheduled = await N.getAllScheduledNotificationsAsync();
    await Promise.all(ourScheduledIds(scheduled.map((s) => ({ identifier: s.identifier }))).map((id) => N.cancelScheduledNotificationAsync(id)));
  } catch {
    // Nothing scheduled or the module is unavailable.
  }
}

/** Replaces our scheduled reminders with the plan for these inputs. Does nothing without the OS permission. */
export async function syncReminders(input: Omit<PlanInput, "now">): Promise<void> {
  const N = loadNative();
  if (!N) return;
  try {
    await configure(N);
    await cancelOurReminders();
    if ((await getPermissionState()).status !== "granted") return;
    for (const r of planReminders({ ...input, now: new Date() })) {
      await N.scheduleNotificationAsync({
        identifier: r.id,
        content: { body: r.body, sound: false },
        trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: r.at, ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}) },
      });
    }
    await N.setBadgeCountAsync(0).catch(() => undefined);
  } catch {
    // Scheduling is best effort; the next app open plans again.
  }
}

/**
 * Registers this device's Expo push token with the server. Skipped where remote push cannot work (Expo Go on Android,
 * no EAS project id, simulators, web). Never throws.
 */
export async function registerPushToken(api: ApiClient): Promise<void> {
  const N = loadNative();
  const Device = loadDevice();
  if (!N || !Device) return;
  try {
    const decision = pushRegistrationDecision({
      executionEnvironment: Constants.executionEnvironment,
      platform: Platform.OS,
      isDevice: Device.isDevice,
      projectId: Constants.expoConfig?.extra?.eas?.projectId as string | undefined,
    });
    if (!decision.register) return;
    if ((await getPermissionState()).status !== "granted") return;
    const { data } = await N.getExpoPushTokenAsync({ projectId: decision.projectId });
    await api.request("POST", "/api/push/tokens", { body: { token: data, platform: Platform.OS } });
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, data);
  } catch {
    // No token (offline, Expo Go limits): local reminders still work.
  }
}

/**
 * Sign-out hook: deletes this device's token on the server (the session is still valid), forgets it locally and
 * cancels our reminders. Bounded so an unreachable server cannot hold sign-out up.
 */
export async function unregisterDevice(api: ApiClient): Promise<void> {
  const work = (async () => {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY).catch(() => null);
    if (token) {
      const r = unregisterTokenRequest(token);
      await api.request(r.method, r.path, r.opts);
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY).catch(() => undefined);
    }
  })();
  await Promise.race([work.catch(() => undefined), new Promise<void>((r) => setTimeout(r, 4000))]);
  await cancelOurReminders();
}
