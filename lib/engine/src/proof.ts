import type { QuestTarget } from "./quest-spec";

/** A place that counts for proof: the user's own, from OpenStreetMap, or learned from many users' sessions. */
export type PlaceKind = "gym" | "sports" | "study";
export interface KnownPlace {
  id: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
  radiusM: number;
  source: "saved" | "osm" | "learned";
  name?: string | null;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  /** ms since epoch */
  at: number;
  /** Android reports fixes from mock-location apps. */
  mocked?: boolean;
}

/** What the phone sends after a live session. Raw sensor and location traces never leave the phone. */
export interface SessionSummary {
  kind: "workout" | "study";
  startedAt: string;
  endedAt: string;
  /** Minutes in which the phone moved like a body in exercise (see activeMinutesFrom). */
  activeMinutes: number;
  steps: number;
  /** The known place the session was at, chosen on the phone from the places the server sent, or null. */
  placeId: string | null;
  /** Share of location fixes inside that place's radius, 0..1. */
  placeShare: number;
  /** Any fix came from a mock-location app. */
  mocked: boolean;
}

export interface Verdict {
  ok: boolean;
  /** One line in THE SYSTEM's voice, shown to the user either way. */
  reason: string;
  /** Evidence chips for the completion window, e.g. ["41 active min", "at Gold's Gym", "3,120 steps"]. */
  evidence: string[];
}

const EARTH_M = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The place most of the session's fixes fall inside, with that share. Places of a kind that doesn't fit the session
 * are ignored (a library doesn't prove a workout). Null when no fix is inside any place.
 */
export function matchPlace(
  points: GeoPoint[],
  places: KnownPlace[],
  sessionKind: SessionSummary["kind"],
): { place: KnownPlace; share: number } | null {
  const fits = (k: PlaceKind) => (sessionKind === "workout" ? k === "gym" || k === "sports" : k === "study");
  const real = points.filter((p) => !p.mocked);
  if (real.length === 0) return null;
  let best: { place: KnownPlace; share: number } | null = null;
  for (const place of places) {
    if (!fits(place.kind)) continue;
    const inside = real.filter((p) => distanceM(p, place) <= place.radiusM).length;
    const share = inside / real.length;
    if (share > 0 && (!best || share > best.share)) best = { place, share };
  }
  return best;
}

/** Per-minute standard deviation of acceleration magnitude (in g) at or above this counts as an active minute. */
export const ACTIVE_MINUTE_STD_G = 0.08;

/**
 * Active minutes from accelerometer samples grouped by minute: each entry is that minute's magnitudes in g
 * (sqrt(x²+y²+z²)). A minute with too few samples (the phone slept) doesn't count.
 */
export function activeMinutesFrom(minutes: number[][], minSamples = 30): number {
  let active = 0;
  for (const m of minutes) {
    if (m.length < minSamples) continue;
    const mean = m.reduce((a, b) => a + b, 0) / m.length;
    const std = Math.sqrt(m.reduce((a, b) => a + (b - mean) ** 2, 0) / m.length);
    if (std >= ACTIVE_MINUTE_STD_G) active++;
  }
  return active;
}

/** Share of a session that must be inside a gym or sports place when the phone itself didn't move (locker). */
export const PLACE_SHARE_REQUIRED = 0.7;

const minutesBetween = (a: string, b: string) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 60000);
const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");

/**
 * Does one workout session prove a workout or steps target? Proven when the phone moved for the target's minutes,
 * or (phone in a locker) when the session lasted the target's minutes with most of it at a gym or sports place.
 * Steps targets need the steps. Mocked locations never prove anything.
 */
export function verifyWorkout(s: SessionSummary, target: QuestTarget, place: KnownPlace | null): Verdict {
  const duration = minutesBetween(s.startedAt, s.endedAt);
  const evidence = [`${fmt(s.activeMinutes)} active min`, `${fmt(duration)} min total`];
  if (s.steps > 0) evidence.push(`${fmt(s.steps)} steps`);
  const atPlace = place !== null && s.placeId === place.id && s.placeShare >= PLACE_SHARE_REQUIRED;
  if (atPlace) evidence.push(`at ${place.name ?? (place.kind === "gym" ? "a gym" : "a sports ground")}`);

  if (s.mocked) return { ok: false, reason: "Your location was faked. THE SYSTEM does not accept it.", evidence };

  if (target.kind === "steps") {
    return s.steps >= target.value
      ? { ok: true, reason: "Steps confirmed.", evidence }
      : { ok: false, reason: `${fmt(s.steps)} of ${fmt(target.value)} steps. Not enough.`, evidence };
  }
  if (target.kind !== "workout") return { ok: false, reason: "This session can't prove that quest.", evidence };

  if (s.activeMinutes >= target.value) return { ok: true, reason: "Movement confirmed.", evidence };
  if (atPlace && duration >= target.value) return { ok: true, reason: "Presence at the gym confirmed.", evidence };

  if (duration < target.value) {
    return { ok: false, reason: `${fmt(duration)} of ${fmt(target.value)} minutes. The session was too short.`, evidence };
  }
  return {
    ok: false,
    reason: place
      ? `Only ${fmt(s.activeMinutes)} active minutes, and not at the gym long enough. Keep the phone on you, or stay at the gym.`
      : `Only ${fmt(s.activeMinutes)} active minutes, and not at a known gym. Keep the phone on you, or save this place as your gym.`,
    evidence,
  };
}

/** Coarse location a session reports for place learning: rounded to about 100 m, never an exact trail. */
export function coarse(p: { lat: number; lng: number }): { lat: number; lng: number } {
  return { lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 };
}

/** Distinct users needed at one spot before it becomes a learned place. */
export const LEARNED_PLACE_MIN_USERS = 3;
export const LEARNED_PLACE_RADIUS_M = 75;

/**
 * Spots where at least LEARNED_PLACE_MIN_USERS different users ran sessions of one kind: each becomes a learned place
 * at the centre of those sessions. Sessions are grouped by their coarse cell, so one busy gym is one place.
 */
export function learnPlaces(
  sessions: { userId: string; kind: PlaceKind; lat: number; lng: number }[],
): Omit<KnownPlace, "id">[] {
  const cells = new Map<string, { kind: PlaceKind; users: Set<string>; lat: number; lng: number; n: number }>();
  for (const s of sessions) {
    const c = coarse(s);
    const key = `${s.kind}:${c.lat}:${c.lng}`;
    const cell = cells.get(key) ?? { kind: s.kind, users: new Set<string>(), lat: 0, lng: 0, n: 0 };
    cell.users.add(s.userId);
    cell.lat += s.lat;
    cell.lng += s.lng;
    cell.n++;
    cells.set(key, cell);
  }
  return [...cells.values()]
    .filter((c) => c.users.size >= LEARNED_PLACE_MIN_USERS)
    .map((c) => ({
      kind: c.kind,
      lat: Math.round((c.lat / c.n) * 1e6) / 1e6,
      lng: Math.round((c.lng / c.n) * 1e6) / 1e6,
      radiusM: LEARNED_PLACE_RADIUS_M,
      source: "learned" as const,
      name: null,
    }));
}

/**
 * Target kinds whose quests can only be completed with proof (spec 10a.1: switched on as each proof part ships).
 * Part 2 ships live sessions for workouts and steps; Part 3 study sessions with a quiz.
 */
export const PROOF_REQUIRED_KINDS: readonly QuestTarget["kind"][] = ["workout", "steps", "study"];

/** True when this quest must be proven by a live session instead of a tap. */
export const needsSessionProof = (target: QuestTarget | null | undefined): boolean =>
  !!target && PROOF_REQUIRED_KINDS.includes(target.kind);
