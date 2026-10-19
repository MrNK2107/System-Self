// Past You: the user's own baseline next to now. Pure helpers and the read. No React Native imports.
import { PastSelfResponseSchema, RANKED_DOMAIN_VALUES, type PastSelfResponse, type RankedDomain } from "@workspace/contracts";
import type { ApiClient } from "../api/client";

export function fetchPastSelf(api: ApiClient): Promise<PastSelfResponse> {
  return api.request("GET", "/api/progress/past-self", { schema: PastSelfResponseSchema });
}

export const pastSelfTitle = (label: string) => `YOU // ${label}`;

export interface PastSelfRow {
  domain: RankedDomain;
  baseline: string;
  current: string;
  /** Signed, e.g. "+3.5", "-1.0", "+0.0". */
  delta: string;
  direction: "up" | "down" | "flat";
}

const fmt = (n: number) => n.toFixed(1);

/** One row per ranked domain: `baseline -> current (+delta)`. Scores read to one decimal. */
export function pastSelfRows(data: Pick<PastSelfResponse, "baseline" | "current">): PastSelfRow[] {
  return RANKED_DOMAIN_VALUES.map((domain) => {
    const b = data.baseline[domain];
    const c = data.current[domain];
    const d = Math.round((c - b) * 10) / 10;
    return {
      domain,
      baseline: fmt(b),
      current: fmt(c),
      delta: `${d < 0 ? "-" : "+"}${fmt(Math.abs(d))}`,
      direction: d > 0 ? "up" : d < 0 ? "down" : "flat",
    };
  });
}

/** `baseline -> current (+delta)` as one line (used for the accessibility label). */
export const pastSelfLine = (r: PastSelfRow) => `${r.baseline} → ${r.current} (${r.delta})`;

export function gymLine(gym: PastSelfResponse["gym"]): string {
  return `${gym.sessionsTotal} ${gym.sessionsTotal === 1 ? "session" : "sessions"} · ${gym.exercisesWithPr} ${gym.exercisesWithPr === 1 ? "PR" : "PRs"}`;
}
