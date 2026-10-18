// Builds the POST /api/onboarding body from what the onboarding screens collect. No React Native imports,
// so the screens, the unit tests and the smoke script share it.
import { RANKED_DOMAIN_VALUES, type OnboardingRequest, type RankedDomain } from "@workspace/contracts";

export type { RankedDomain };
export const RANKED_DOMAINS: readonly RankedDomain[] = RANKED_DOMAIN_VALUES;

export type IdentitySetting = OnboardingRequest["identitySetting"];

export const DEFAULT_MORNING_TIME = "07:00";
export const DEFAULT_NIGHTLY_TIME = "21:00";
export const MIN_GOAL_LENGTH = 5;
export const MAX_GOAL_LENGTH = 200;
export const MAX_STOPPED_BEFORE_LENGTH = 500;
export const DEFAULT_RATING = 5;

export interface OnboardingDraft {
  ratings: Record<RankedDomain, number>;
  primaryGoal: string;
  weakness: RankedDomain;
  /** Optional free text: "What has stopped you before?" */
  stoppedBefore: string;
  identity: IdentitySetting;
  timezone: string;
}

/** The request body (schema input shape: the server canonicalises the timezone). */
export interface OnboardingPayload {
  ratings: Record<RankedDomain, number>;
  primaryGoal: string;
  biggestWeakness: RankedDomain;
  stoppedBefore?: string;
  identitySetting: IdentitySetting;
  morningTime: string;
  nightlyTime: string;
  timezone: string;
  clientId?: string;
}

/** The zone to onboard with: the device's, else the account's, else UTC. */
export function pickTimezone(device: string, account: string): string {
  return device.trim() || account.trim() || "UTC";
}

export function buildOnboardingPayload(draft: OnboardingDraft, clientId?: string): OnboardingPayload {
  const stoppedBefore = draft.stoppedBefore.trim().slice(0, MAX_STOPPED_BEFORE_LENGTH);
  return {
    ratings: { ...draft.ratings },
    primaryGoal: draft.primaryGoal.trim(),
    biggestWeakness: draft.weakness,
    ...(stoppedBefore ? { stoppedBefore } : {}),
    identitySetting: draft.identity,
    morningTime: DEFAULT_MORNING_TIME,
    nightlyTime: DEFAULT_NIGHTLY_TIME,
    timezone: draft.timezone,
    ...(clientId ? { clientId } : {}),
  };
}

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
const isDomain = (v: string): v is RankedDomain => (RANKED_DOMAINS as readonly string[]).includes(v);
const isIdentity = (v: string): v is IdentitySetting => v === "anonymous" || v === "semi-public" || v === "public";

/** Ratings out of the `ratings` route param; a missing or damaged entry falls back to DEFAULT_RATING. */
export function parseRatings(raw: string | string[] | undefined): Record<RankedDomain, number> {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(one(raw));
  } catch {
    parsed = null;
  }
  const src = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const out = {} as Record<RankedDomain, number>;
  for (const d of RANKED_DOMAINS) {
    const v = src[d];
    out[d] = typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 10 ? v : DEFAULT_RATING;
  }
  return out;
}

/**
 * The draft carried through the onboarding screens as route params. Null when the goal or weakness is
 * missing (the screen was opened out of order), so the caller can send the user back to the assessment.
 */
export function draftFromParams(params: Params, timezone: string): OnboardingDraft | null {
  const primaryGoal = one(params.primaryGoal).trim();
  const weakness = one(params.weakness);
  if (primaryGoal.length < MIN_GOAL_LENGTH || !isDomain(weakness)) return null;
  const identity = one(params.identity);
  return {
    ratings: parseRatings(params.ratings),
    primaryGoal,
    weakness,
    stoppedBefore: one(params.stoppedBefore),
    identity: isIdentity(identity) ? identity : "semi-public",
    timezone,
  };
}
