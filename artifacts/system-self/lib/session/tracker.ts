// Live session tracking (spec 8.2): a foreground-service location task, the accelerometer and the step counter.
// Raw samples stay on the phone; only the summary built in buildSummary() is sent to the server.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { Accelerometer, Pedometer } from "expo-sensors";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { coarse, matchPlace, type GeoPoint, type KnownPlace, type SessionSummary } from "@workspace/engine";

import { addSample, finishMovement, newMovement, type MovementState } from "./minutes";

export const LOCATION_TASK = "system-self-session-location";
const STATE_KEY = "session:active:v1";
const POINTS_KEY = "session:points:v1";
/** Accelerometer at 10 Hz: enough to tell exercise from a phone lying still, light on battery. */
const ACCEL_INTERVAL_MS = 100;

export interface ActiveSession {
  questId: string;
  kind: SessionSummary["kind"];
  startedAt: number;
  movement: MovementState;
  steps: number;
  places: KnownPlace[];
  /** True when location runs as a foreground service (works with the screen off); false = only while the app is open. */
  background: boolean;
}

// The location task runs in the background (headless JS while the foreground service is up). It only appends points;
// the UI owns everything else, so the two never write the same key.
if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error || !data) return;
    const locations = (data as { locations?: Location.LocationObject[] }).locations ?? [];
    if (locations.length === 0) return;
    await appendPoints(locations.map(toPoint));
  });
}

const toPoint = (l: Location.LocationObject): GeoPoint => ({
  lat: l.coords.latitude,
  lng: l.coords.longitude,
  at: l.timestamp,
  mocked: l.mocked === true,
});

async function appendPoints(points: GeoPoint[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(POINTS_KEY);
    const prev: GeoPoint[] = raw ? JSON.parse(raw) : [];
    await AsyncStorage.setItem(POINTS_KEY, JSON.stringify([...prev, ...points].slice(-2000)));
  } catch {
    // A lost point is fine; the session keeps sampling.
  }
}

export async function readPoints(): Promise<GeoPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(POINTS_KEY);
    return raw ? (JSON.parse(raw) as GeoPoint[]) : [];
  } catch {
    return [];
  }
}

export async function loadActiveSession(): Promise<ActiveSession | null> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as ActiveSession) : null;
  } catch {
    return null;
  }
}

export async function saveActiveSession(s: ActiveSession): Promise<void> {
  await AsyncStorage.setItem(STATE_KEY, JSON.stringify(s)).catch(() => undefined);
}

export type PermissionResult = { location: "background" | "foreground" | "denied"; motion: boolean };

/**
 * Asks for what a session needs, in plain order: location while in use, then "all the time" (so tracking survives
 * the screen turning off), then physical activity for the step counter. Any of them may be refused; the session
 * still runs with what it has, and the summary says what was missing.
 */
export async function requestSessionPermissions(): Promise<PermissionResult> {
  let location: PermissionResult["location"] = "denied";
  const fg = await Location.requestForegroundPermissionsAsync().catch(() => null);
  if (fg?.granted) {
    location = "foreground";
    const bg = await Location.requestBackgroundPermissionsAsync().catch(() => null);
    if (bg?.granted) location = "background";
  }
  const motion = (await Pedometer.requestPermissionsAsync().catch(() => null))?.granted ?? false;
  return { location, motion };
}

/** Where the phone is now, or null without permission or a fix within 15 s. */
export async function currentPosition(): Promise<{ lat: number; lng: number; mocked: boolean } | null> {
  try {
    const l = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
    ]);
    return l ? { lat: l.coords.latitude, lng: l.coords.longitude, mocked: l.mocked === true } : null;
  } catch {
    return null;
  }
}

let foregroundWatch: Location.LocationSubscription | null = null;

/** Starts location sampling: a foreground service when "all the time" is granted, else a watch while the app is open. */
export async function startLocation(background: boolean, label: string): Promise<boolean> {
  await AsyncStorage.removeItem(POINTS_KEY).catch(() => undefined);
  if (background) {
    try {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 60_000,
        distanceInterval: 0,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: "THE SYSTEM is watching",
          notificationBody: label,
          notificationColor: "#A879FF",
          killServiceOnDestroy: false,
        },
      });
      return true;
    } catch {
      // Fall through to the in-app watch.
    }
  }
  foregroundWatch = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, timeInterval: 60_000, distanceInterval: 0 },
    (l) => void appendPoints([toPoint(l)]),
  ).catch(() => null);
  return false;
}

export async function stopLocation(): Promise<void> {
  foregroundWatch?.remove();
  foregroundWatch = null;
  if (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
  }
}

/** Subscribes to the accelerometer and the step counter; returns an unsubscribe. */
export function startMotion(onSample: (x: number, y: number, z: number, at: number) => void, onSteps: (steps: number) => void): () => void {
  Accelerometer.setUpdateInterval(ACCEL_INTERVAL_MS);
  const accel = Accelerometer.addListener(({ x, y, z }) => onSample(x, y, z, Date.now()));
  let pedo: { remove: () => void } | null = null;
  if (Platform.OS === "android" || Platform.OS === "ios") {
    try {
      pedo = Pedometer.watchStepCount((r) => onSteps(r.steps));
    } catch {
      pedo = null;
    }
  }
  return () => {
    accel.remove();
    pedo?.remove();
  };
}

export const newSession = (questId: string, kind: SessionSummary["kind"], places: KnownPlace[], background: boolean): ActiveSession => ({
  questId,
  kind,
  startedAt: Date.now(),
  movement: newMovement(Date.now()),
  steps: 0,
  places,
  background,
});

export const addMotion = (s: ActiveSession, x: number, y: number, z: number, at: number): ActiveSession => ({
  ...s,
  movement: addSample(s.movement, x, y, z, at),
});

/** The summary sent to the server: movement, steps, the matched place and share, mocked flag, coarse centre. */
export function buildSummary(s: ActiveSession, points: GeoPoint[], endedAt: number): SessionSummary & { coarse: { lat: number; lng: number } | null } {
  const match = matchPlace(points, s.places, s.kind);
  const real = points.filter((p) => !p.mocked);
  const centre =
    real.length > 0
      ? coarse({ lat: real.reduce((a, p) => a + p.lat, 0) / real.length, lng: real.reduce((a, p) => a + p.lng, 0) / real.length })
      : null;
  return {
    kind: s.kind,
    startedAt: new Date(s.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    activeMinutes: finishMovement(s.movement).activeMinutes,
    steps: Math.max(0, Math.round(s.steps)),
    placeId: match?.place.id ?? null,
    placeShare: Math.round((match?.share ?? 0) * 100) / 100,
    mocked: points.some((p) => p.mocked),
    coarse: centre,
  };
}

export async function clearActiveSession(): Promise<void> {
  await AsyncStorage.multiRemove([STATE_KEY, POINTS_KEY]).catch(() => undefined);
}
