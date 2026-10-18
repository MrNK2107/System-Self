// Network logic behind the onboarding screens. No React Native imports.
import { GameStateSchema, type GameState } from "@workspace/contracts";
import { ApiError, type ApiClient } from "../api/client";
import { gameStateKey } from "../game/keys";
import { onboardingStatusKey, rejectsOnlyTimezone } from "../auth/actions";
import type { OnboardingPayload } from "./payload";

export const PROFILE_SCHEMA = GameStateSchema.shape.profile;
export type Profile = GameState["profile"];

/**
 * POST /api/onboarding. A 409 already_onboarded (an earlier attempt landed but its reply was lost) is not a
 * failure: the state that attempt created is read back instead.
 */
export async function submitOnboarding(api: ApiClient, payload: OnboardingPayload): Promise<GameState> {
  try {
    return await api.request("POST", "/api/onboarding", {
      body: payload,
      schema: GameStateSchema,
      ...(payload.clientId ? { idempotencyKey: payload.clientId } : {}),
    });
  } catch (e) {
    if (e instanceof ApiError && e.kind === "http" && e.status === 409 && e.code === "already_onboarded") {
      return api.request("GET", "/api/state", { schema: GameStateSchema });
    }
    throw e;
  }
}

/**
 * submitOnboarding, but a rejection that blames only the timezone is retried with each fallback zone in turn
 * (the account's, then "UTC"), so an odd device zone never blocks onboarding.
 */
export async function submitOnboardingWithFallback(
  api: ApiClient,
  payload: OnboardingPayload,
  fallbackZones: string[],
): Promise<GameState> {
  const zones = [payload.timezone, ...fallbackZones.filter((z) => z && z !== payload.timezone)];
  let lastError: unknown;
  for (const timezone of zones) {
    try {
      return await submitOnboarding(api, { ...payload, timezone });
    } catch (e) {
      lastError = e;
      if (!rejectsOnlyTimezone(e)) throw e;
    }
  }
  throw lastError;
}

export interface ScheduleTimes {
  morningTime: string;
  nightlyTime: string;
}

/** PATCH /api/profile with the chosen briefing times. */
export function updateSchedule(api: ApiClient, times: ScheduleTimes, idempotencyKey?: string): Promise<Profile> {
  return api.request("PATCH", "/api/profile", {
    body: times,
    schema: PROFILE_SCHEMA,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

/** The slice of QueryClient these helpers need. */
export interface QueryStore {
  setQueryData(key: readonly unknown[], updater: unknown): unknown;
}

/** After onboarding succeeded: the gate sees "onboarded" and the game state is already in the cache. */
export function applyOnboarded(store: QueryStore, userId: string, state: GameState): void {
  store.setQueryData(gameStateKey(userId), state);
  store.setQueryData(onboardingStatusKey(userId), "onboarded");
}

/** Keeps a cached GameState's profile in step with a profile update. */
export function applyProfile(store: QueryStore, userId: string, profile: Profile): void {
  store.setQueryData(gameStateKey(userId), (old: GameState | undefined) => (old ? { ...old, profile } : old));
}

/** SYSTEM-voice line for a failed onboarding request. Shows the server's first validation issue when it has one. */
export function describeOnboardingError(err: unknown): string {
  if (!(err instanceof ApiError)) return "Calibration failed. Retry.";
  if (err.kind === "network") return "No connection. Check your signal and retry.";
  if (err.kind !== "http") return "The system is unavailable. Retry shortly.";
  const status = err.status ?? 0;
  if (status === 429) return "Too many attempts. Wait a moment, then retry.";
  if (status >= 500) return "The system is unavailable. Retry shortly.";
  if (status === 400) {
    const first = err.issues[0]?.message;
    return first ? `Rejected: ${first}` : "Those answers were rejected. Go back, check them and retry.";
  }
  return "Calibration failed. Retry.";
}

/** True when a plain retry can succeed (connection, server trouble, rate limit). */
export function canRetry(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  if (err.kind !== "http") return true;
  const status = err.status ?? 0;
  return status >= 500 || status === 429;
}
