// Life context and season modes: pure helpers and requests. No React Native imports.
import { SeasonSchema, SeasonsResponseSchema, type Season, type SeasonKind, type SeasonsResponse } from "@workspace/contracts";
import { LIFE_CONTEXTS, SEASON_LINES, addDays, localDate } from "@workspace/engine";
import { ApiError, type ApiClient } from "../api/client";
import type { Outbox } from "../api/outbox";
import { afterOutbox, type MutationResult } from "./actions";

export const MIN_SEASON_DAYS = 1;
export const MAX_SEASON_DAYS = 14;

export const lifeContextOptions = () => LIFE_CONTEXTS.map((c) => ({ key: c.key, label: c.label }));

export const SEASON_LABELS: Record<SeasonKind, string> = {
  exam: "Exam",
  crunch: "Crunch",
  competition: "Competition",
  launch: "Launch",
  away: "Away",
};

export const seasonLine = (kind: SeasonKind): string => SEASON_LINES[kind];

/** Today's local date in `tz` (the account timezone); falls back to `fallbackTz`, then UTC, when `tz` is empty or unknown. */
export function todayInZone(tz: string | null | undefined, now: Date = new Date(), fallbackTz = "UTC"): string {
  for (const zone of [tz, fallbackTz, "UTC"]) {
    if (!zone) continue;
    try {
      return localDate(now, zone);
    } catch {
      // unknown zone: try the next one
    }
  }
  return localDate(now, "UTC");
}

/**
 * Selectable start dates: tomorrow onward (seasons are planned ahead, never started in the moment), and not
 * before `earliest` (the server's earliest allowed start, which accounts for the cooldown after the last season).
 */
export function startDateChoices(today: string, count = 14, earliest?: string): { date: string; label: string }[] {
  const tomorrow = addDays(today, 1);
  const first = earliest && earliest > tomorrow ? earliest : tomorrow;
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(first, i);
    return { date, label: date.slice(5) };
  });
}

export function clampSeasonLength(n: number): number {
  if (!Number.isFinite(n)) return MIN_SEASON_DAYS;
  return Math.min(MAX_SEASON_DAYS, Math.max(MIN_SEASON_DAYS, Math.trunc(n)));
}

/** The dashboard chip: the season's line and when it ends. */
export function seasonChipLine(season: { endsOn: string; line: string }): { title: string; meta: string } {
  return { title: season.line, meta: `Until ${season.endsOn}` };
}

/** SYSTEM-voice line for a failed season request. */
export function describeSeasonError(err: unknown): string {
  if (!(err instanceof ApiError)) return "The request failed. Retry.";
  if (err.kind === "network") return "No connection. Check your signal and retry.";
  if (err.kind !== "http") return "The system is unavailable. Retry shortly.";
  switch (err.code) {
    case "season_conflict":
      return "One season at a time, with seven days between. Pick a later start.";
    case "invalid_kind":
      return "That season is not available for your life context.";
    case "invalid_dates":
      return "Start tomorrow or later. Length is 1 to 14 days.";
    case "season_started":
      return "That season has already started. It runs its course.";
    default:
      return (err.status ?? 0) >= 500 ? "The system is unavailable. Retry shortly." : "The request was rejected.";
  }
}

export function fetchSeasons(api: ApiClient): Promise<SeasonsResponse> {
  return api.request("GET", "/api/seasons", { schema: SeasonsResponseSchema });
}

/** Schedules a season. A plain mutation, so queued logs land first. */
export function scheduleSeason(
  api: ApiClient,
  outbox: Pick<Outbox, "flushBeforeMutation">,
  input: { kind: SeasonKind; startsOn: string; lengthDays: number },
  clientId: string,
): Promise<MutationResult<Season>> {
  return afterOutbox(outbox, () =>
    api.request("POST", "/api/seasons", { body: { ...input, clientId }, idempotencyKey: clientId, schema: SeasonSchema }),
  );
}

/** Cancels a scheduled season (the server refuses one that has started). */
export function cancelSeason(
  api: ApiClient,
  outbox: Pick<Outbox, "flushBeforeMutation">,
  id: string,
  clientId: string,
): Promise<MutationResult<unknown>> {
  return afterOutbox(outbox, () =>
    api.request("DELETE", `/api/seasons/${encodeURIComponent(id)}`, { idempotencyKey: clientId }),
  );
}
